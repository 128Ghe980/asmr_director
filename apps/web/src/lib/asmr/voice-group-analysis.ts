import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./pcm-audio";
import type { VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
import { getVoiceGenerationRoot } from "./voice-generation-recordings";
import { VoiceAnalysisWorker, VoiceGroupAnalysisError, type VoiceAnalysisWorkerSpawn } from "./voice-analysis-worker";
import { VoiceBoundaryOnlySchema, VoiceRecognitionSchema, isCuttingOnlyRecognition, type VoiceRecognition } from "./voice-recognition";
export { VoiceGroupAnalysisError } from "./voice-analysis-worker";

type AnalysisChild = {
  pid?: number;
  once(event: "error", callback: (error: Error) => void): unknown;
  once(event: "close", callback: (code: number | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};
export type VoiceAnalysisSpawn = (
  command: string, args: readonly string[],
  options: { cwd: string; shell: false; windowsHide: true; stdio: "ignore"; env: NodeJS.ProcessEnv },
) => AnalysisChild;

type Dependencies = {
  runtimeSession?: VoxCpm2RuntimeSession;
  spawnImpl?: VoiceAnalysisSpawn;
  workerSpawnImpl?: VoiceAnalysisWorkerSpawn;
  timeoutMs?: number;
  exitWaitMs?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  apiTimeoutMs?: number;
  // Server/test dependency only; never accepted in a generation HTTP request.
  readinessImpl?: (config: LocalRuntimeConfig) => Promise<{ pythonPath: string; modelPath: string }>;
};

const cancelError = () => new VoiceGroupAnalysisError("已取消生成。", 499);
const unavailableError = () => new VoiceGroupAnalysisError("本机长文语音检查尚未就绪，请检查语音分析环境。", 503);
const unsafeError = () => new VoiceGroupAnalysisError("未能确认安全切分位置；完整原音已保留，请试听。", 422);
const analysisCache = new Map<string, { checkedAt: number; result: Promise<{ pythonPath: string; modelPath: string }> }>();
const workers = new WeakMap<VoxCpm2RuntimeSession, VoiceAnalysisWorker>();
const sessionRuntimes = new WeakMap<VoxCpm2RuntimeSession, Promise<{ pythonPath: string; modelPath: string }>>();

export function shouldReuseVoiceAnalysis(freeBytes = os.freemem(), mode = process.env.ASMR_VOICE_ASR_REUSE): boolean {
  if (mode === "always") return true;
  if (mode === "off") return false;
  // The native TTS models already occupy several GiB. Do not keep Whisper
  // resident beside them on a small-memory machine just to save a reload.
  return freeBytes >= 8 * 1024 ** 3;
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelError();
}

function waitForChild(child: AnalysisChild, options: {
  signal?: AbortSignal; timeoutMs: number; exitWaitMs: number; onExit: () => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let exitConfirmed = false;
    let stopping: VoiceGroupAnalysisError | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const confirmExit = () => {
      if (exitConfirmed) return;
      exitConfirmed = true;
      options.onExit();
    };
    const finish = (error?: VoiceGroupAnalysisError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(exitTimer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const stop = (error: VoiceGroupAnalysisError) => {
      if (stopping || finished) return;
      stopping = error;
      exitTimer = setTimeout(() => finish(new VoiceGroupAnalysisError("语音检查进程尚未退出，请稍后再试。", 503)), options.exitWaitMs);
      try { child.kill("SIGKILL"); } catch { /* No directory cleanup until exit is confirmed. */ }
    };
    const abort = () => stop(cancelError());
    const timer = setTimeout(() => stop(new VoiceGroupAnalysisError("语音检查超时，请稍后重试。", 504)), options.timeoutMs);
    child.once("error", () => {
      if (!child.pid) { confirmExit(); finish(unavailableError()); }
      else stop(unavailableError());
    });
    child.once("close", (code) => {
      confirmExit();
      finish(stopping ?? (code === 0 ? undefined : unavailableError()));
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

const spawnOptions = (cwd: string) => ({
  cwd, shell: false as const, windowsHide: true as const, stdio: "ignore" as const,
  env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PYTHONUTF8: "1" },
});

async function isFile(filePath: string): Promise<boolean> {
  try { return (await stat(filePath)).isFile(); } catch { return false; }
}

async function resolveAnalysisRuntime(config: LocalRuntimeConfig): Promise<{ pythonPath: string; modelPath: string }> {
  const modelPath = config.voiceAnalysisModelPath ?? path.join(config.runtimeRoot, "engines", "gpt-sovits", "GPT-SoVITS", "tools", "asr", "models", "faster-whisper-large-v3");
  const candidates = config.voiceAnalysisPythonPath ? [config.voiceAnalysisPythonPath] : [
    path.join(config.runtimeRoot, "audio-quality-v1", ".venv", "Scripts", "python.exe"),
    path.join(config.runtimeRoot, "engines", "gpt-sovits", "env-comfyui-clone", "python.exe"),
  ];
  const key = JSON.stringify([modelPath, candidates]);
  const existing = analysisCache.get(key);
  if (existing && Date.now() - existing.checkedAt < 30_000) return existing.result;
  const result = (async () => {
    for (const name of ["model.bin", "config.json", "tokenizer.json"]) {
      if (!(await isFile(path.join(modelPath, name)))) throw unavailableError();
    }
    for (const pythonPath of candidates) {
      if (!(await isFile(pythonPath))) continue;
      try {
        const child = spawn(pythonPath, ["-c", "import faster_whisper, numpy, scipy, soundfile; from opencc import OpenCC; OpenCC('t2s')"], spawnOptions(path.dirname(pythonPath)));
        await waitForChild(child, { timeoutMs: 30_000, exitWaitMs: 5_000, onExit: () => {} });
        return { pythonPath, modelPath };
      } catch { /* A missing/broken optional environment may fall back to the next configured local runtime. */ }
    }
    throw unavailableError();
  })();
  analysisCache.set(key, { checkedAt: Date.now(), result });
  return result;
}

type ReadinessDependencies = Pick<Dependencies, "runtimeSession" | "readinessImpl">;

function resolveSessionAnalysisRuntime(config: LocalRuntimeConfig, dependencies: ReadinessDependencies) {
  // A native take can outlast the catalog cache. Reuse its initial environment
  // probe until this candidate closes instead of importing Python again.
  const session = dependencies.runtimeSession;
  let runtime = session?.onClose ? sessionRuntimes.get(session) : undefined;
  if (!runtime) {
    runtime = (dependencies.readinessImpl ?? resolveAnalysisRuntime)(config);
    if (session?.onClose) {
      sessionRuntimes.set(session, runtime);
      session.onClose(async () => { sessionRuntimes.delete(session); });
    }
  }
  return runtime;
}

export async function getVoiceAnalysisReadiness(config: LocalRuntimeConfig, dependencies: ReadinessDependencies = {}): Promise<{ available: boolean; reason?: string }> {
  try {
    await resolveSessionAnalysisRuntime(config, dependencies);
    return { available: true };
  } catch { return { available: false, reason: "本机长文语音检查尚未就绪。" }; }
}

const AnalysisResultSchema = z.object({
  version: z.literal(1), success: z.literal(true),
  internalPausesMs: z.array(z.number().finite().min(0).max(10_000)).max(31),
  leadingQuietMs: z.number().finite().min(0).max(120_000),
  trailingQuietMs: z.number().finite().min(0).max(120_000),
  transcript: z.string().max(2000), coverage: z.number().finite().min(0).max(1),
  recognition: VoiceRecognitionSchema.optional(),
  boundaryOnly: VoiceBoundaryOnlySchema.optional(),
  cutStartSeconds: z.number().finite().min(0).max(120),
  cutEndSeconds: z.number().finite().positive().max(120),
  asrModel: z.literal("faster-whisper-large-v3/cpu/int8"),
  cutValidation: z.object({
    method: z.enum(["two_sided", "noise_adapted"]),
    thresholdDbfs: z.number().finite().min(-120).max(-30),
    quietStartSeconds: z.number().finite().min(0).max(120),
    quietEndSeconds: z.number().finite().positive().max(120),
  }).strict().refine((value) => value.quietEndSeconds - value.quietStartSeconds >= .16 - 1 / 48_000
    && (value.method !== "noise_adapted" || value.thresholdDbfs <= -60), "Invalid quiet validation").optional(),
}).strict();

export type VoiceGroupAnalysis = Omit<z.infer<typeof AnalysisResultSchema>, "version" | "success"> & { wav: Uint8Array };

function quietMatchesWordBoundary(samples: Float32Array, left: { text: string; start: number; end: number },
  right: { text: string; start: number; end: number }, validation: NonNullable<VoiceGroupAnalysis["cutValidation"]>): boolean {
  const tolerance = 1 / 48_000;
  const quietStart = validation.quietStartSeconds, quietEnd = validation.quietEndSeconds;
  // Python selects an unambiguous acoustic boundary. Verify its source binding
  // here without choosing a second region or requiring identical frame rounding.
  if (quietStart >= left.end + .08 - tolerance && quietEnd <= right.start - .08 + tolerance) return true;
  const letters = (text: string) => Array.from(text.replace(/[^\p{L}\p{N}]/gu, "")).length;
  const singleLeft = letters(left.text) === 1, singleRight = letters(right.text) === 1;
  const lower = (singleLeft ? left.start : left.end) + .08;
  const upper = (singleRight ? right.end : right.start) - .08;
  if ((!singleLeft && !singleRight) || quietStart < lower - tolerance || quietEnd > upper + tolerance) return false;
  const threshold = 10 ** (validation.thresholdDbfs / 20);
  const activity = (start: number, end: number) => {
    const first = Math.max(0, Math.ceil(start * 100 - 1e-8));
    const last = Math.min(Math.floor(samples.length / 480), Math.floor(end * 100 + 1e-8));
    for (let index = first; index < last; index++) {
      let sum = 0;
      for (let frame = index * 480; frame < (index + 1) * 480; frame++) sum += samples[frame] ** 2;
      if (Math.sqrt(sum / 480) >= threshold) return true;
    }
    return false;
  };
  return activity(left.start, quietStart) && activity(quietEnd, right.end);
}
/**
 * Verify the cut's source identity and acoustic/PCM boundaries. Text similarity
 * is deliberately a measurement only: users decide content by listening.
 */
export function assertCuttingOnlyVoiceAnalysis(analysis: VoiceGroupAnalysis, sourceWav: Uint8Array,
  request: { expectedText: string; followingText?: string; clauses: string[] }): void {
  const evidence = VoiceRecognitionSchema.safeParse(analysis.recognition);
  const boundary = VoiceBoundaryOnlySchema.safeParse(analysis.boundaryOnly);
  const fail = () => { throw new VoiceGroupAnalysisError(unsafeError().message, 422, "unsafe_cutting_boundary", analysis.recognition); };
  if (!evidence.success || !boundary.success || !isCuttingOnlyRecognition(evidence.data)) return fail();
  const recognition = evidence.data, located = boundary.data;
  if (recognition.stage !== "complete" || recognition.expectedText !== request.expectedText
      || (recognition.followingText ?? "") !== (request.followingText ?? "")
      || !Number.isFinite(analysis.coverage) || analysis.coverage < 0 || analysis.coverage > 1) return fail();
  const source = decodePcmWav(sourceWav), decoded = decodePcmWav(analysis.wav);
  const sampleRate = 48_000, tolerance = 1 / sampleRate;
  const sourceDuration = source.samples.length / sampleRate;
  if (source.channels !== 1 || source.sampleRate !== sampleRate || decoded.channels !== 1 || decoded.sampleRate !== sampleRate
      || Math.abs(analysis.cutStartSeconds) > tolerance || analysis.cutEndSeconds <= 0
      || analysis.cutEndSeconds > sourceDuration + tolerance) return fail();
  const words = recognition.sourceWords ?? [];
  const endIndex = located.targetEndWordIndex;
  if (analysis.transcript !== recognition.targetTranscript) return fail();
  const hasFollowing = Boolean(request.followingText?.trim());
  if (hasFollowing) {
    if (located.method !== "ordered_word_boundary" || endIndex < 0 || endIndex >= words.length
        || located.followingStartWordIndex !== endIndex + 1 || located.followingStartWordIndex >= words.length
        || words.some(word => word.end > sourceDuration + .04)
        || recognition.targetTranscript !== words.slice(0, endIndex + 1).map(word => word.text).join("")
        || analysis.cutEndSeconds >= sourceDuration) return fail();
  } else if (located.method !== "whole_recording" || located.followingStartWordIndex !== undefined || endIndex !== words.length - 1
      || Math.abs(analysis.cutEndSeconds - sourceDuration) > tolerance) return fail();
  const positions = located.internalPausePositions;
  if (positions.length !== analysis.internalPausesMs.length || positions.some(position => position >= request.clauses.length - 1)
      || analysis.internalPausesMs.some(value => !Number.isFinite(value) || value < 0)) return fail();
  const quiet = analysis.cutValidation;
  if (hasFollowing && !quiet) return fail();
  if (quiet && hasFollowing) {
    if (!Number.isFinite(quiet.thresholdDbfs) || quiet.thresholdDbfs < -120 || quiet.thresholdDbfs > -30
        || quiet.quietStartSeconds < 0 || quiet.quietEndSeconds > sourceDuration + tolerance
        || quiet.quietEndSeconds - quiet.quietStartSeconds < .16 - tolerance
        || analysis.cutEndSeconds - quiet.quietStartSeconds < .08 - tolerance
        || quiet.quietEndSeconds - analysis.cutEndSeconds < .08 - tolerance) return fail();
    if (!quietMatchesWordBoundary(source.samples, words[endIndex], words[endIndex + 1], quiet)) return fail();
    const start = Math.ceil(quiet.quietStartSeconds * sampleRate), end = Math.floor(quiet.quietEndSeconds * sampleRate);
    if (end <= start || end > source.samples.length) return fail();
    const threshold = 10 ** (quiet.thresholdDbfs / 20);
    for (let offset = start; offset < end; offset += 480) {
      const stop = Math.min(offset + 480, end);
      let sum = 0;
      for (let frame = offset; frame < stop; frame++) sum += source.samples[frame] ** 2;
      if (Math.sqrt(sum / (stop - offset)) > threshold + 1e-7) return fail();
    }
  }
  const expectedFrames = Math.round(analysis.cutEndSeconds * sampleRate);
  if (!expectedFrames || decoded.samples.length !== expectedFrames
      || (hasFollowing && (analysis.leadingQuietMs + analysis.trailingQuietMs >= expectedFrames / sampleRate * 1000
        || !decoded.samples.some(sample => Math.abs(sample) > 1e-5)))
      || decoded.samples.some((sample, index) => sample !== source.samples[index])) return fail();
}

const AnalysisFailureSchema = z.object({
  version: z.literal(1), success: z.literal(false), code: z.string().regex(/^[a-z_]{1,80}$/),
  recognition: VoiceRecognitionSchema.optional(),
}).strict();
const MAX_ANALYSIS_JSON_BYTES = 1024 * 1024;

async function readAnalysisResponse(filePath: string): Promise<unknown> {
  if ((await stat(filePath)).size > MAX_ANALYSIS_JSON_BYTES) throw unsafeError();
  return JSON.parse(await readFile(filePath, "utf8"));
}

function responseRecognition(response: unknown, expectedText: string, followingText?: string): VoiceRecognition | undefined {
  const parsed = VoiceRecognitionSchema.safeParse(response && typeof response === "object" && "recognition" in response ? response.recognition : undefined);
  const recognition = parsed.success ? parsed.data : undefined;
  // A checkpoint from another request must never be presented as this take's evidence.
  return recognition?.expectedText === expectedText && (recognition.followingText ?? "") === (followingText ?? "") ? recognition : undefined;
}

async function scriptPath() {
  const candidates = [path.resolve("scripts", "analyze-voice-group.py"), path.resolve("apps", "web", "scripts", "analyze-voice-group.py")];
  for (const candidate of candidates) if (await isFile(candidate)) return candidate;
  throw unavailableError();
}

export async function analyzeVoiceGroup(input: {
  wav: Uint8Array; expectedText: string; followingText?: string; clauses: string[];
  // Paragraph cuts require independent recognition on both sides even when
  // the source text and coarse timestamps match exactly.
  requireTwoSided?: boolean;
  allowShortSentenceParticle?: boolean;
  allowShortSentenceTextReview?: boolean;
  config: LocalRuntimeConfig; signal?: AbortSignal;
}, dependencies: Dependencies = {}): Promise<VoiceGroupAnalysis> {
  try {
    return await analyzeVoiceGroupImpl(input, dependencies);
  } catch (error) {
    const safe = input.signal?.aborted ? cancelError() : error instanceof VoiceGroupAnalysisError ? error : unsafeError();
    const recognition = error instanceof VoiceGroupAnalysisError ? error.recognition : undefined;
    throw new VoiceGroupAnalysisError(safe.message, safe.statusCode, safe.diagnosticCode, safe.recognition ?? recognition ?? {
      analysisMode: "cutting_only", stage: safe.statusCode === 422 ? "input_validation" : "unavailable",
      sourceTranscript: "", expectedText: input.expectedText.slice(0, 500),
      ...(input.followingText ? { followingText: input.followingText.slice(0, 1500) } : {}),
    });
  }
}

async function analyzeVoiceGroupImpl(input: Parameters<typeof analyzeVoiceGroup>[0], dependencies: Dependencies): Promise<VoiceGroupAnalysis> {
  checkCancelled(input.signal);
  if (!input.expectedText.trim() || input.expectedText.length > 500 || (input.followingText?.length ?? 0) > 1500
      || input.clauses.length < 1 || input.clauses.length > 32 || input.clauses.some((clause) => !clause.trim())
      || input.wav.byteLength > 24 * 1024 * 1024) throw unsafeError();
  let source: ReturnType<typeof decodePcmWav>;
  try { source = decodePcmWav(input.wav); } catch { throw unsafeError(); }
  const sourceDuration = source.samples.length / source.sampleRate;
  if (source.channels !== 1 || source.sampleRate !== 48_000 || sourceDuration <= 0 || sourceDuration > 120) throw unsafeError();
  const session = dependencies.runtimeSession;
  const runtime = await resolveSessionAnalysisRuntime(input.config, dependencies);
  checkCancelled(input.signal);
  const helper = await scriptPath();
  const temporaryRoot = path.join(getVoiceGenerationRoot(input.config), "analysis-runs");
  await mkdir(temporaryRoot, { recursive: true });
  const canonicalRoot = await realpath(temporaryRoot);
  const directory = await mkdtemp(path.join(canonicalRoot, "group-"));
  const outputJson = path.join(directory, "result.json");
  let confirmedExit = true;
  try {
    const requestPath = path.join(directory, "request.json");
    const outputWav = path.join(directory, "output.wav");
    await writeFile(path.join(directory, "input.wav"), input.wav);
    await writeFile(requestPath, JSON.stringify({
      version: 1, inputWav: path.join(directory, "input.wav"), outputWav, outputJson,
      modelPath: runtime.modelPath, expectedText: input.expectedText,
      followingText: input.followingText ?? "", clauses: input.clauses, cuttingOnly: true,
    }), "utf8");
    checkCancelled(input.signal);
    if (session?.onClose && !dependencies.spawnImpl && (workers.has(session) || shouldReuseVoiceAnalysis())) {
      let worker = workers.get(session);
      if (!worker) {
        worker = new VoiceAnalysisWorker({ ...runtime, helper, cwd: canonicalRoot, runtimeSession: session,
          spawnImpl: dependencies.workerSpawnImpl, timeoutMs: dependencies.timeoutMs ?? 300_000,
          exitWaitMs: dependencies.exitWaitMs ?? 5_000 });
        workers.set(session, worker);
        const createdWorker = worker;
        session.onClose(async () => { await createdWorker.close(); workers.delete(session); });
      }
      confirmedExit = false;
      try {
        await worker.run(requestPath, input.signal);
        // The worker stays alive, but its completion message guarantees this
        // request's files are closed and no longer in use.
        confirmedExit = true;
      } finally {
        confirmedExit ||= worker.exitConfirmed;
        if (process.env.ASMR_VOICE_ASR_REUSE !== "always" && os.freemem() < 6 * 1024 ** 3) {
          await worker.close();
          workers.delete(session);
          confirmedExit ||= worker.exitConfirmed;
        }
      }
    } else {
      const child = (dependencies.spawnImpl ?? spawn)(runtime.pythonPath, [helper, "--request", requestPath], spawnOptions(directory));
      confirmedExit = false;
      session?.processStarted(child.pid);
      await waitForChild(child, {
        signal: input.signal, timeoutMs: dependencies.timeoutMs ?? 300_000, exitWaitMs: dependencies.exitWaitMs ?? 5_000,
        onExit: () => { confirmedExit = true; session?.processExited(child.pid); },
      });
    }
    checkCancelled(input.signal);
    const response = await readAnalysisResponse(outputJson);
    const failure = AnalysisFailureSchema.safeParse(response);
    const unavailable = failure.success && ["analysis_failed", "analysis_incomplete"].includes(failure.data.code);
    if (failure.success) throw new VoiceGroupAnalysisError(
      unavailable ? unavailableError().message : unsafeError().message,
      unavailable ? 503 : 422, failure.data.code,
      responseRecognition(response, input.expectedText, input.followingText));
    const result = AnalysisResultSchema.safeParse(response);
    if (!result.success || !isCuttingOnlyRecognition(result.data.recognition) || !result.data.boundaryOnly) throw unsafeError();
    if ((await stat(outputWav)).size > input.wav.byteLength + 4096) throw unsafeError();
    const wav = new Uint8Array(await readFile(outputWav));
    const { version: _version, success: _success, ...details } = result.data;
    void _version; void _success;
    const analysis = { ...details, wav };
    assertCuttingOnlyVoiceAnalysis(analysis, input.wav, input);
    checkCancelled(input.signal);
    return analysis;
  } catch (error) {
    const safe = error instanceof VoiceGroupAnalysisError ? error : unsafeError();
    // A timeout, worker failure or malformed crop must not erase recognition
    // already checkpointed before the process stopped or its files are removed.
    const recognition = safe.recognition ?? await readAnalysisResponse(outputJson)
      .then((response) => responseRecognition(response, input.expectedText, input.followingText)).catch(() => undefined);
    throw new VoiceGroupAnalysisError(safe.message, safe.statusCode, safe.diagnosticCode, recognition);
  } finally {
    // Resolve and check immediately before recursive deletion; never remove a live
    // child's working directory or a path outside this task's temporary root.
    if (confirmedExit) {
      const resolved = await realpath(directory).catch(() => null);
      if (resolved && path.dirname(resolved) === canonicalRoot && path.basename(resolved).startsWith("group-")) {
        await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  }
}
