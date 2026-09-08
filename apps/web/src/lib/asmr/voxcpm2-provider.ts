import { spawn } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AudioCandidateProvenance } from "./audio-candidate";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./project-mix-renderer";
import { resolveVoxCpm2ProfilePath, type VoiceReferenceMode } from "./voice-provider-catalog";
import { loadVoxCpm2Profile, selectVoxCpm2Reference } from "./voxcpm2-profile";
import { VoxCpm2Error } from "./voxcpm2-error";
import { withVoxCpm2RuntimeSession, type VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
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
};

// These controls are server/test dependencies; the HTTP route never accepts them.
type ProviderDependencies = {
  runtimeSession?: VoxCpm2RuntimeSession;
  spawnImpl?: VoxCpm2Spawn;
  seed?: number;
  maxSteps?: number;
  timeoutMs?: number;
  exitWaitMs?: number;
};

const cancelError = () => new VoxCpm2Error("已取消生成。", 499);
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_LOG_LENGTH = 65_536;
// The supported VoxCPM2 GGUF architecture has 4 latent frames * 1920 decode samples.
const SAMPLES_PER_STEP = 7680;

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelError();
}

function waitForProcess(
  child: VoxCpm2Child,
  { signal, timeoutMs, exitWaitMs }: { signal?: AbortSignal; timeoutMs: number; exitWaitMs: number },
  onConfirmedExit: () => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stopping: VoxCpm2Error | null = null;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let log = "";
    const capture = (chunk: Buffer | string) => { log = (log + chunk.toString()).slice(-MAX_LOG_LENGTH); };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    const finish = (error?: VoxCpm2Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(terminationTimer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(log);
    };
    const stop = (error: VoxCpm2Error) => {
      if (settled || stopping) return;
      stopping = error;
      terminationTimer = setTimeout(() => finish(new VoxCpm2Error("生成进程尚未停止，请稍后再试。", 503)), exitWaitMs);
      try { child.kill("SIGKILL"); } catch { /* Keep the exclusive lock until exit is confirmed. */ }
    };
    const abort = () => stop(cancelError());
    const timer = setTimeout(() => stop(new VoxCpm2Error("生成超时，请缩短台词后重试。", 504)), timeoutMs);
    child.once("error", () => {
      if (!child.pid) {
        onConfirmedExit();
        finish(new VoxCpm2Error("VoxCPM2 无法启动，请检查本机运行环境。", 503));
      } else {
        stop(new VoxCpm2Error("VoxCPM2 生成失败，请稍后重试。"));
      }
    });
    child.once("close", (code) => {
      onConfirmedExit();
      finish(stopping ?? (code === 0 ? undefined : new VoxCpm2Error("VoxCPM2 生成失败，请稍后重试。")));
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
  const maxSteps = dependencies.maxSteps ?? Math.min(600, Math.max(120, Array.from(normalizedText).length * 5 + 60));
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exitWaitMs = dependencies.exitWaitMs ?? 5_000;
  const seed = dependencies.seed ?? randomInt(1, 2_147_483_647);
  if (!Number.isInteger(maxSteps) || maxSteps < 120 || maxSteps > 600 || !Number.isInteger(seed) || seed < 1 || seed > 2_147_483_646 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000 || !Number.isInteger(exitWaitMs) || exitWaitMs < 1 || exitWaitMs > 30_000) {
    throw new VoxCpm2Error("VoxCPM2 运行参数无效。", 503);
  }
  const profile = await loadVoxCpm2Profile(resolveVoxCpm2ProfilePath(config)).catch(() => {
    throw new VoxCpm2Error("VoxCPM2 配置不可用，请检查本机模型与参考声音配置。", 503);
  });
  const reference = (() => {
    try { return selectVoxCpm2Reference(profile, voicePackId); }
    catch { throw new VoxCpm2Error("参考声音不可用，请重新选择。", 400); }
  })();
  if (referenceMode === "with_reference_text" && !reference.promptText) {
    throw new VoxCpm2Error("这个声音尚未配置参考文本，请选择仅参考音频。", 400);
  }

  let confirmedExit = true;
  let temporaryRoot: string | undefined;
  const temporaryBase = path.resolve(config.runtimeRoot, "voxcpm2-product", "runs");
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
    const child = spawnImpl(profile.cliPath, args, { cwd: path.dirname(profile.cliPath), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    confirmedExit = false;
    dependencies.runtimeSession.processStarted(child.pid);
    const completion = waitForProcess(child, { signal, timeoutMs, exitWaitMs }, () => { confirmedExit = true; dependencies.runtimeSession!.processExited(); });
    await completion;
    checkCancelled(signal);
    const outputInfo = await stat(outputPath).catch(() => { throw new VoxCpm2Error("VoxCPM2 没有生成有效音频，请重试。"); });
    if (!outputInfo.isFile() || outputInfo.size < 44 || outputInfo.size > 24 * 1024 * 1024) throw new VoxCpm2Error("VoxCPM2 没有生成有效音频，请重试。");
    const output = await readFile(outputPath);
    const decoded = (() => {
      try { return decodePcmWav(output); }
      catch { throw new VoxCpm2Error("VoxCPM2 返回的音频已损坏，请重试。"); }
    })();
    if (decoded.sampleRate !== 48_000 || decoded.channels !== 1 || !decoded.samples.length || !decoded.samples.some((sample) => Math.abs(sample) > .0001)) {
      throw new VoxCpm2Error("VoxCPM2 没有生成有效的 48 kHz 人声音频，请重试。");
    }
    const generatedSteps = decoded.samples.length / SAMPLES_PER_STEP;
    if (generatedSteps >= maxSteps - 0.001) throw new VoxCpm2Error("片段达到生成长度上限，请拆短台词后重试。");
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
      qualityWarnings: clipping > decoded.samples.length * .001 ? ["这条候选可能有削波失真，请试听后决定是否采用。"] : [],
    };
  } catch (error) {
    if (error instanceof VoxCpm2Error) throw error;
    throw new VoxCpm2Error("VoxCPM2 生成失败，请检查本机运行环境后重试。");
  } finally {
    // A failed kill never permits another request to overlap the still-running native process.
    if (confirmedExit) {
      if (temporaryRoot && path.resolve(temporaryRoot).startsWith(temporaryBase + path.sep)) {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
  }
}
