import { spawn } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AudioCandidateProvenance } from "./audio-candidate";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { getLocalStorageError, LocalStorageError } from "./local-storage-error";
import { decodePcmWav } from "./project-mix-renderer";
import { resolveVoxCpm2ProfilePath, type VoiceReferenceMode } from "./voice-provider-catalog";
import { loadVoxCpm2Profile, selectVoxCpm2Reference } from "./voxcpm2-profile";
import { VoxCpm2Error } from "./voxcpm2-error";
import { withVoxCpm2RuntimeSession, type VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
import { getVoiceGenerationRoot } from "./voice-generation-recordings";
import { startNativeResourceObserver, type NativeResourceObserver, type NativeResourceSummary } from "./native-resource-observer";
export { VoxCpm2Error } from "./voxcpm2-error";

type VoxCpm2Child = {
  pid?: number;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};
export type VoxCpm2Spawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; shell: false; windowsHide: true; stdio: ["ignore", "pipe", "pipe"] },
) => VoxCpm2Child;

export type GenerateVoxCpm2Input = {
  text: string;
  voicePackId: string;
  referenceMode: VoiceReferenceMode;
  config: LocalRuntimeConfig;
  signal?: AbortSignal;
  now?: Date;
  // Internal publisher: retain exact native output before any quality decision.
  onRawOutput?: (wav: Uint8Array) => Promise<void>;
};

// These controls are server/test dependencies; the HTTP route never accepts them.
type ProviderDependencies = {
  // Internal paragraph recipe only; keeps the established clip route intact.
  paragraphMode?: boolean;
  runtimeSession?: VoxCpm2RuntimeSession;
  spawnImpl?: VoxCpm2Spawn;
  observeResources?: typeof startNativeResourceObserver;
  resourceObservationWaitMs?: number;
  seed?: number;
  maxSteps?: number;
  timeoutMs?: number;
  exitWaitMs?: number;
};

const cancelError = () => new VoxCpm2Error("已取消生成。", 499);
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_LOG_LENGTH = 65_536;
const MAX_STREAM_TAIL_LENGTH = MAX_LOG_LENGTH / 2;
const MAX_SPAWN_ERROR_LENGTH = 4096;
// The supported VoxCPM2 GGUF architecture has 4 latent frames * 1920 decode samples.
const SAMPLES_PER_STEP = 7680;

type NativeDiagnostic = {
  pid: number | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  exitConfirmed: boolean;
  stdoutTail: string;
  stderrTail: string;
  spawnError: { name: string; message: string; code?: string } | null;
  resources?: NativeResourceSummary;
};

function diagnosticError(error: unknown): NonNullable<NativeDiagnostic["spawnError"]> {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return {
    name: (error instanceof Error ? error.name : "Error").slice(0, 80),
    message: (error instanceof Error ? error.message : String(error)).slice(-MAX_SPAWN_ERROR_LENGTH),
    ...(code ? { code: code.slice(0, 80) } : {}),
  };
}

type ProviderError = VoxCpm2Error | LocalStorageError;

function hasNativeContextCapacityFailure(output: string): boolean {
  // The CLI also echoes arbitrary target/reference text. Only its runtime or
  // failure-record prefixes identify an error, never the spoken phrase alone.
  return /^(?:(?:VoxCPM2Runtime|(?:Combined|Continuation|Voice) cloning failed|Generation failed):[ \t]*(?:prefill|decode) context capacity exceeded:[ \t]*(?:tokens|position)=-?\d+[ \t]+capacity=\d+\b|VoxCPM2ResidualLM::(?:prefill_kv|forward_step):[ \t]*context capacity exceeded[ \t]*\((?:tokens|position)=-?\d+[ \t]+capacity=\d+\))/im.test(output);
}

function classifiedNativeFailure(diagnostic: NativeDiagnostic, error?: unknown): ProviderError | undefined {
  const storageError = getLocalStorageError(error);
  if (storageError) return storageError;
  const cause = diagnostic.spawnError ?? (error ? diagnosticError(error) : undefined);
  const output = `${diagnostic.stdoutTail}\n${diagnostic.stderrTail}\n${cause?.message ?? ""}`;
  if (getLocalStorageError(cause) || /\bENOSPC\b|\bEDQUOT\b|No space left on device|There is not enough space on the disk|\bdisk (?:is )?full\b|\[WinError 112\]/i.test(output)) {
    return new LocalStorageError();
  }
  // A CUDA allocator failure identifies the allocation stage, not which
  // process or memory budget caused it. Device allocations may also depend on
  // system commit, so do not promise that closing another GPU app will fix it.
  if (/\bcudaMalloc(?:Async)?\b[^\r\n]{0,120}\bfailed:[ \t]*out of memory\b|\bCUDA (?:error: )?out of memory\b/i.test(output)) {
    return new VoxCpm2Error("语音模型的显卡内存分配失败，请检查显存和系统内存余量后重试。", 503);
  }
  if (cause?.code === "ENOMEM" || /\bstd::bad_alloc\b|\bcannot allocate memory\b|\bENOMEM\b/i.test(output)) {
    return new VoxCpm2Error("语音模型运行内存不足，请关闭占用较大的程序后重试。", 503);
  }
  // cuBLAS initialization can fail after a valid reference has loaded. This
  // identifies the GPU stage without assuming memory exhaustion or changing
  // the selected reference behind the user's back.
  if (/\bCUBLAS_STATUS_NOT_INITIALIZED\b|\bCUDA_ERROR_INITIALIZATION_ERROR\b|\bcudaErrorInitializationError\b|\bCUDA (?:error: )?initialization error\b/i.test(output)) {
    return new VoxCpm2Error("显卡语音运行初始化失败，请稍后重试。", 503);
  }
  if (/GGML_ASSERT\s*\(\s*grid_y\s*<\s*USHRT_MAX\s*\)\s*failed/i.test(output)) {
    return new VoxCpm2Error("生成音频超出本机解码容量，请缩短生成范围后重试。", 400);
  }
  if (hasNativeContextCapacityFailure(output) || /\btoo many tokens\b|GGML_ASSERT\s*\(\s*n_tokens\s*<=\s*n_(?:batch|ctx)\s*\)|\b(?:input|prompt|sequence) (?:token )?length\b[^\r\n]{0,100}\bexceeds?\b[^\r\n]{0,80}\b(?:context|capacity|maximum|max)\b/i.test(output)) {
    return new VoxCpm2Error("本次输入超过语音模型的上下文容量，请缩短生成范围后重试。", 400);
  }
  return undefined;
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelError();
}

function waitForProcess(
  child: VoxCpm2Child,
  { signal, timeoutMs, exitWaitMs }: { signal?: AbortSignal; timeoutMs: number; exitWaitMs: number },
  onConfirmedExit: () => void,
  diagnostic: NativeDiagnostic,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exitConfirmed = false;
    let stopping: ProviderError | null = null;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let log = "";
    const capture = (stream: "stdoutTail" | "stderrTail") => (chunk: Buffer | string) => {
      const text = chunk.toString();
      log = (log + text).slice(-MAX_LOG_LENGTH);
      diagnostic[stream] = (diagnostic[stream] + text).slice(-MAX_STREAM_TAIL_LENGTH);
    };
    const confirmExit = () => {
      if (exitConfirmed) return;
      exitConfirmed = true;
      diagnostic.exitConfirmed = true;
      onConfirmedExit();
    };
    child.stdout?.on("data", capture("stdoutTail"));
    child.stderr?.on("data", capture("stderrTail"));
    const finish = (error?: ProviderError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(terminationTimer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(log);
    };
    const stop = (error: ProviderError) => {
      if (settled || stopping) return;
      stopping = error;
      terminationTimer = setTimeout(() => finish(getLocalStorageError(stopping) ?? new VoxCpm2Error("生成进程尚未停止，请稍后再试。", 503)), exitWaitMs);
      try { child.kill("SIGKILL"); } catch { /* Keep the exclusive lock until exit is confirmed. */ }
    };
    const abort = () => stop(cancelError());
    const timer = setTimeout(() => stop(new VoxCpm2Error("生成超时，请缩短台词后重试。", 504)), timeoutMs);
    child.once("error", (error) => {
      diagnostic.spawnError = diagnosticError(error);
      if (!child.pid) {
        confirmExit();
        finish(classifiedNativeFailure(diagnostic) ?? new VoxCpm2Error("VoxCPM2 无法启动，请检查本机运行环境。", 503));
      } else {
        stop(classifiedNativeFailure(diagnostic) ?? new VoxCpm2Error("VoxCPM2 生成失败，请稍后重试。"));
      }
    });
    child.once("close", (code, closeSignal) => {
      diagnostic.exitCode = code;
      diagnostic.signal = closeSignal;
      confirmExit();
      finish(stopping ?? (code === 0 ? undefined : classifiedNativeFailure(diagnostic) ?? new VoxCpm2Error("VoxCPM2 生成失败，请稍后重试。")));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function fileIdentity(filePath: string) {
  const info = await stat(filePath);
  return `${path.basename(filePath)}:bytes=${info.size}:mtime=${info.mtimeMs}`;
}

async function executableHash(filePath: string, signal?: AbortSignal) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, { highWaterMark: 256 * 1024, signal });
  try {
    for await (const chunk of stream) hash.update(chunk);
    checkCancelled(signal);
    return hash.digest("hex");
  } catch (error) {
    checkCancelled(signal);
    throw error;
  } finally {
    stream.destroy();
  }
}

export async function generateVoxCpm2(
  input: GenerateVoxCpm2Input,
  dependencies: ProviderDependencies = {},
): Promise<{ wav: Uint8Array; provenance: AudioCandidateProvenance; qualityWarnings: string[] }> {
  const { text, voicePackId, referenceMode, config, signal } = input;
  checkCancelled(signal);
  if (!dependencies.runtimeSession) {
    return withVoxCpm2RuntimeSession(config, signal, (runtimeSession) => generateVoxCpm2(input, { ...dependencies, runtimeSession }));
  }
  if (dependencies.runtimeSession.runtimeRoot !== path.resolve(config.runtimeRoot)) throw new VoxCpm2Error("生成会话已失效。", 503);
  const normalizedText = text.trim();
  if (!normalizedText || Array.from(normalizedText).length > 500 || normalizedText.includes("\0")) {
    throw new VoxCpm2Error("请填写 1–500 字的台词，较长内容请拆成多个片段。", 400);
  }
  if (referenceMode !== "reference_only" && referenceMode !== "with_reference_text") {
    throw new VoxCpm2Error("请选择受支持的参考模式。", 400);
  }
  const maxSteps = dependencies.maxSteps ?? (dependencies.paragraphMode ? 800 : Math.min(600, Math.max(120, Array.from(normalizedText).length * 5 + 60)));
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exitWaitMs = dependencies.exitWaitMs ?? 5_000;
  const seed = dependencies.seed ?? randomInt(1, 2_147_483_647);
  if (!Number.isInteger(maxSteps) || maxSteps < 120 || maxSteps > (dependencies.paragraphMode ? 800 : 600) || !Number.isInteger(seed) || seed < 1 || seed > 2_147_483_646 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000 || !Number.isInteger(exitWaitMs) || exitWaitMs < 1 || exitWaitMs > 30_000) {
    throw new VoxCpm2Error("VoxCPM2 运行参数无效。", 503);
  }
  const profile = await loadVoxCpm2Profile(resolveVoxCpm2ProfilePath(config), { naturalReferenceText: dependencies.paragraphMode }).catch(() => {
    throw new VoxCpm2Error("VoxCPM2 配置不可用，请检查本机模型与参考声音配置。", 503);
  });
  if (dependencies.paragraphMode && config.voxcpm2ParagraphCliPath) profile.cliPath = path.resolve(config.voxcpm2ParagraphCliPath);
  const reference = (() => {
    try { return selectVoxCpm2Reference(profile, voicePackId); }
    catch { throw new VoxCpm2Error("参考声音不可用，请重新选择。", 400); }
  })();
  if (referenceMode === "with_reference_text" && !reference.promptText) {
    throw new VoxCpm2Error("这个声音尚未配置参考文本，请选择仅参考音频。", 400);
  }

  let confirmedExit = true;
  let temporaryRoot: string | undefined;
  let rawPublished = false;
  let operationFinished = false;
  let lateRecoveryStarted = false;
  let resourceObserver: Promise<NativeResourceObserver | undefined> | undefined;
  const temporaryBase = path.join(getVoiceGenerationRoot(config), "runs");
  const nativeDiagnostic: NativeDiagnostic = { pid: null, exitCode: null, signal: null, exitConfirmed: false, stdoutTail: "", stderrTail: "", spawnError: null };
  const diagnosticPath = path.join(getVoiceGenerationRoot(config), "diagnostics", `voxcpm2-${randomUUID()}.json`);
  let failure: { message: string; statusCode: number } | undefined;
  let diagnosticWrite = Promise.resolve();
  const persistDiagnostic = () => {
    if (!failure) return diagnosticWrite;
    const snapshot = JSON.stringify({ version: 1, provider: "voxcpm2", recordedAt: new Date().toISOString(), failure, native: nativeDiagnostic });
    // Serial writes let a late close update the same record after an exit-wait
    // timeout. Diagnostics are server-only and never replace the public error.
    diagnosticWrite = diagnosticWrite.then(async () => {
      await mkdir(path.dirname(diagnosticPath), { recursive: true });
      await writeFile(diagnosticPath, snapshot, { encoding: "utf8", mode: 0o600 });
    }).catch(() => undefined);
    return diagnosticWrite;
  };
  const recoverRawOutput = async () => {
    if (rawPublished || !confirmedExit || !temporaryRoot || !input.onRawOutput) return;
    const outputPath = path.join(temporaryRoot, "output.wav");
    const info = await stat(outputPath).catch(() => undefined);
    if (info?.isFile() && info.size > 0 && info.size <= 24 * 1024 * 1024) {
      await input.onRawOutput(new Uint8Array(await readFile(outputPath)));
      rawPublished = true;
    }
  };
  const removeTemporaryOutput = async () => {
    if (temporaryRoot && path.resolve(temporaryRoot).startsWith(temporaryBase + path.sep)) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  };
  try {
    checkCancelled(signal);
    const referenceInfo = await stat(reference.audioPath);
    if (referenceInfo.size > 16 * 1024 * 1024) throw new VoxCpm2Error("参考音频过大，请检查本机声音配置。", 503);
    const referenceBytes = await readFile(reference.audioPath);
    try {
      const audio = decodePcmWav(referenceBytes);
      if (audio.sampleRate !== 16_000 || audio.channels !== 1 || !audio.samples.length) throw new Error("Invalid reference");
    } catch { throw new VoxCpm2Error("参考音频需要使用有效的 16 kHz 单声道 PCM WAV。", 503); }
    const [runtimeHash, baseIdentity, acousticIdentity] = await Promise.all([
      executableHash(profile.cliPath, signal),
      fileIdentity(profile.baseModelPath), fileIdentity(profile.acousticModelPath),
    ]);
    await mkdir(temporaryBase, { recursive: true });
    temporaryRoot = await mkdtemp(path.join(temporaryBase, "candidate-"));
    const outputPath = path.join(temporaryRoot, "output.wav");
    const args = ["-t", normalizedText, "-o", outputPath, "--steps", String(maxSteps), "--timesteps", "10", "--cfg", "2", "--temperature", "1", "--seed", String(seed), "--n-gpu-layers", "0", "--low-vram", "-r", reference.audioPath];
    if (referenceMode === "with_reference_text") args.push("--prompt-wav", reference.audioPath, "--prompt-text", reference.promptText!);
    args.push(profile.baseModelPath, profile.acousticModelPath);
    checkCancelled(signal);
    const spawnImpl: VoxCpm2Spawn = dependencies.spawnImpl ?? ((command, parameters, options) => spawn(command, [...parameters], options));
    let child: VoxCpm2Child;
    try { child = spawnImpl(profile.cliPath, args, { cwd: path.dirname(profile.cliPath), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { nativeDiagnostic.spawnError = diagnosticError(error); throw error; }
    nativeDiagnostic.pid = child.pid ?? null;
    confirmedExit = false;
    dependencies.runtimeSession.processStarted(child.pid);
    const completion = waitForProcess(child, { signal, timeoutMs, exitWaitMs }, () => {
      confirmedExit = true;
      if (operationFinished && !lateRecoveryStarted) {
        lateRecoveryStarted = true;
        // The caller may already have received an exit-wait timeout. Only this
        // confirmed close makes its final output safe to publish and clean up.
        void (async () => {
          try {
            await persistDiagnostic();
            await recoverRawOutput();
            if (rawPublished || !input.onRawOutput) await removeTemporaryOutput();
          } finally { await dependencies.runtimeSession!.processExited(child.pid); }
        })().catch(() => undefined);
      } else dependencies.runtimeSession!.processExited(child.pid);
    }, nativeDiagnostic);
    // Real native children get an optional, small stdlib-only observer. Fake
    // test processes stay entirely in-process unless a monitor is injected.
    if (!dependencies.spawnImpl || dependencies.observeResources) {
      resourceObserver = Promise.resolve().then(() => (dependencies.observeResources ?? startNativeResourceObserver)({ pid: child.pid, config }))
        .catch(() => undefined);
    }
    await completion;
    checkCancelled(signal);
    // A capacity error must not become a completed candidate even if a CLI
    // returns zero. The ordinary recovery path still preserves source bytes.
    if (hasNativeContextCapacityFailure(`${nativeDiagnostic.stdoutTail}\n${nativeDiagnostic.stderrTail}`)) {
      throw new VoxCpm2Error("本次输入超过语音模型的上下文容量，请缩短生成范围后重试。", 400);
    }
    const outputInfo = await stat(outputPath).catch(() => { throw new VoxCpm2Error("VoxCPM2 没有生成有效音频，请重试。"); });
    if (!outputInfo.isFile() || outputInfo.size < 44 || outputInfo.size > 24 * 1024 * 1024) throw new VoxCpm2Error("VoxCPM2 没有生成有效音频，请重试。");
    const output = await readFile(outputPath);
    if (input.onRawOutput) { await input.onRawOutput(new Uint8Array(output)); rawPublished = true; }
    const decoded = (() => {
      try { return decodePcmWav(output); }
      catch { throw new VoxCpm2Error("VoxCPM2 返回的音频已损坏，请重试。"); }
    })();
    if (decoded.sampleRate !== 48_000 || decoded.channels !== 1 || !decoded.samples.length) {
      throw new VoxCpm2Error("VoxCPM2 没有生成有效的 48 kHz 人声音频，请重试。");
    }
    const generatedSteps = decoded.samples.length / SAMPLES_PER_STEP;
    const qualityWarnings: string[] = [];
    if (generatedSteps >= maxSteps - 0.001) qualityWarnings.push("录音达到模型长度上限，可能没有读完。完整原音已保留，请试听后决定是否重新生成。");
    if (!decoded.samples.some((sample) => Math.abs(sample) > .0001)) qualityWarnings.push("这条录音接近静音，完整原音已保留，可以试听或下载检查。");
    const clipping = decoded.samples.reduce((count, sample) => count + Number(Math.abs(sample) >= .999), 0);
    return {
      wav: new Uint8Array(output),
      provenance: {
        provider: "voxcpm2", model: "VoxCPM2", seed, temperature: 1,
        voicePackId: reference.id, referenceMode, generationMode: "clip",
        parameters: { cfg: 2, timesteps: 10, gpuLayers: 0, lowVram: true, maxSteps, generatedSteps, timeoutMs },
        runtimeVersion: `sha256:${runtimeHash}`,
        modelIdentity: `${baseIdentity}|${acousticIdentity}`,
        referenceIdentity: `sha256:${createHash("sha256").update(referenceBytes).update(referenceMode === "with_reference_text" ? reference.promptText! : "").digest("hex")}`,
      },
      qualityWarnings: [...qualityWarnings, ...(clipping > decoded.samples.length * .001 ? ["这条候选可能有削波失真，请试听后决定是否采用。"] : [])],
    };
  } catch (error) {
    const reported = getLocalStorageError(error) ?? (error instanceof VoxCpm2Error ? error
      : classifiedNativeFailure(nativeDiagnostic, error) ?? new VoxCpm2Error("VoxCPM2 生成失败，请检查本机运行环境后重试。"));
    failure = { message: reported.message, statusCode: reported.statusCode };
    throw reported;
  } finally {
    let observationDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      if (resourceObserver) {
        // Bound optional setup as well as shutdown: even a stalled filesystem
        // lookup must not hold a completed native request or its reservation.
        // If setup resolves late, this chain still asks that observer to exit.
        const finished = resourceObserver.then((observer) => observer?.finish()).catch(() => undefined);
        const resources = await Promise.race([finished, new Promise<undefined>((resolve) => {
          observationDeadline = setTimeout(() => resolve(undefined), Math.min(2500, Math.max(1, dependencies.resourceObservationWaitMs ?? 2500)));
        })]);
        if (resources) nativeDiagnostic.resources = resources;
      }
    } catch { /* Optional diagnostics cannot change the native result. */ }
    finally { clearTimeout(observationDeadline); }
    // Write while the request still owns its temporary directory. A confirmed
    // late exit during this await is handled by the ordinary cleanup below.
    await persistDiagnostic();
    operationFinished = true;
    // A failed kill never permits another request to overlap the still-running native process.
    if (confirmedExit) {
      // A native failure/timeout may still leave audio. Publish only after exit;
      // a later close recovers it above when this finally block cannot do so.
      await recoverRawOutput().catch(() => undefined);
      if (rawPublished || !input.onRawOutput) await removeTemporaryOutput();
    }
  }
}
