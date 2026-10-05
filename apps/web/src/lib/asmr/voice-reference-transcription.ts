import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { getLocalStorageError } from "./local-storage-error";
import { buildVoiceReferenceConversionArgs, MAX_VOICE_REFERENCE_BYTES, validateVoiceReferenceAudio, VoiceReferenceImportError } from "./voice-reference-import";
import { VoxCpm2Error } from "./voxcpm2-error";
import { withVoxCpm2RuntimeSession, type VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

export const VOICE_REFERENCE_LANGUAGES = ["zh", "en", "ja", "ko"] as const;
export type VoiceReferenceLanguage = typeof VOICE_REFERENCE_LANGUAGES[number];
export class VoiceReferenceTranscriptionError extends Error {
  constructor(message: string, readonly statusCode = 500) { super(message); }
}
export type VoiceReferenceTranscriptionInput = {
  bytes: Uint8Array; filename: string; startSeconds: number; durationSeconds: number;
  language: string; config: LocalRuntimeConfig; signal?: AbortSignal;
};
export type VoiceReferenceTranscription = {
  transcript: string; language: VoiceReferenceLanguage; startSeconds: number; durationSeconds: number;
};
type NativeChild = {
  pid?: number;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};
export type VoiceReferenceTranscriptionSpawn = (command: string, args: readonly string[], options: {
  cwd: string; shell: false; windowsHide: true; stdio: "ignore"; env: NodeJS.ProcessEnv;
}) => NativeChild;
type RuntimePaths = { pythonPath: string; modelPath: string };
type Dependencies = {
  spawnImpl?: VoiceReferenceTranscriptionSpawn; timeoutMs?: number; exitWaitMs?: number;
  resolveRuntimeImpl?: (config: LocalRuntimeConfig) => Promise<RuntimePaths>;
};
const cancelled = () => new VoiceReferenceTranscriptionError("已取消识别参考文字。", 499);
const timedOut = () => new VoiceReferenceTranscriptionError("参考文字识别超时，请缩短片段后重试。", 504);
const unavailable = () => new VoiceReferenceTranscriptionError("本机文字识别环境不可用，请检查已安装的 Whisper 模型与 Python 环境。", 503);
function check(signal?: AbortSignal, deadline = Infinity) {
  if (signal?.aborted) throw cancelled();
  if (Date.now() >= deadline) throw timedOut();
}
async function isFile(filename: string) {
  try { const info = await stat(filename); return info.isFile() && info.size > 0; } catch { return false; }
}

/** File checks only: recognition never downloads weights or loads a resident worker. */
async function resolveRuntime(config: LocalRuntimeConfig): Promise<RuntimePaths> {
  const modelPath = config.voiceAnalysisModelPath ?? path.join(config.runtimeRoot, "engines", "gpt-sovits", "GPT-SoVITS", "tools", "asr", "models", "faster-whisper-large-v3");
  for (const file of ["model.bin", "config.json", "tokenizer.json"]) if (!await isFile(path.join(modelPath, file))) throw unavailable();
  const candidates = config.voiceAnalysisPythonPath ? [config.voiceAnalysisPythonPath] : [
    path.join(config.runtimeRoot, "audio-quality-v1", ".venv", "Scripts", "python.exe"),
    path.join(config.runtimeRoot, "engines", "gpt-sovits", "env-comfyui-clone", "python.exe"),
  ];
  for (const pythonPath of candidates) {
    if (!await isFile(pythonPath)) continue;
    const parent = path.dirname(pythonPath);
    const environment = path.basename(parent).toLowerCase() === "scripts" ? path.dirname(parent) : parent;
    if (!config.voiceAnalysisPythonPath && !await isFile(path.join(environment, "Lib", "site-packages", "faster_whisper", "__init__.py"))) continue;
    return { pythonPath, modelPath };
  }
  throw unavailable();
}

function waitForChild(child: NativeChild, session: VoxCpm2RuntimeSession, options: {
  signal?: AbortSignal; timeoutMs: number; exitWaitMs: number; phase: "conversion" | "recognition"; onExit: () => void;
}): Promise<void> {
  session.processStarted(child.pid);
  return new Promise((resolve, reject) => {
    let settled = false, exited = false, stopping: VoiceReferenceTranscriptionError | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const confirmExit = () => {
      if (exited) return;
      exited = true; options.onExit();
      void Promise.resolve(session.processExited(child.pid)).catch(() => {});
    };
    const finish = (error?: VoiceReferenceTranscriptionError) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(exitTimer); options.signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const stop = (error: VoiceReferenceTranscriptionError) => {
      if (settled || stopping) return;
      stopping = error;
      exitTimer = setTimeout(() => finish(new VoiceReferenceTranscriptionError("识别进程尚未停止，请稍后重试。", 503)), options.exitWaitMs);
      try { child.kill("SIGKILL"); } catch { /* Retain scratch and reservation until an exit is observed. */ }
    };
    const abort = () => stop(cancelled());
    const timer = setTimeout(() => stop(timedOut()), options.timeoutMs);
    child.once("error", () => { if (!child.pid) { confirmExit(); finish(unavailable()); } else stop(unavailable()); });
    child.once("close", code => {
      confirmExit();
      finish(stopping ?? (code === 0 ? undefined : options.phase === "conversion"
        ? new VoiceReferenceTranscriptionError("音频转换失败，请使用可播放的 MP3 或 WAV。", 422) : unavailable()));
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

function safeError(error: unknown, signal?: AbortSignal): VoiceReferenceTranscriptionError {
  if (error instanceof VoiceReferenceTranscriptionError) return error;
  if (signal?.aborted) return cancelled();
  if (error instanceof VoiceReferenceImportError) return new VoiceReferenceTranscriptionError(error.message, error.statusCode);
  if (error instanceof VoxCpm2Error) return new VoiceReferenceTranscriptionError(error.statusCode === 409 ? "本机语音任务正在运行，请等待完成后再识别。" : "无法准备本机文字识别任务，请检查运行环境。", error.statusCode);
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (getLocalStorageError(error) || code === "ENOSPC" || code === "EDQUOT") return new VoiceReferenceTranscriptionError("存储空间不足，无法识别参考文字，请释放空间后重试。", 507);
  return new VoiceReferenceTranscriptionError("参考文字识别失败，请检查音频并重试。", 500);
}

export async function transcribeVoiceReference(input: VoiceReferenceTranscriptionInput, dependencies: Dependencies = {}): Promise<VoiceReferenceTranscription> {
  const deadline = Date.now() + (dependencies.timeoutMs ?? 180_000);
  let directory: string | undefined, confirmedExit = true, operationFinished = false;
  try {
    check(input.signal, deadline);
    const extension = path.extname(input.filename).toLowerCase();
    if (extension !== ".mp3" && extension !== ".wav") throw new VoiceReferenceTranscriptionError("请上传 MP3 或 WAV 音频。", 415);
    if (!input.bytes.byteLength) throw new VoiceReferenceTranscriptionError("请上传非空音频文件。", 400);
    if (input.bytes.byteLength > MAX_VOICE_REFERENCE_BYTES) throw new VoiceReferenceTranscriptionError("音频文件过大（上限 32 MB）。", 413);
    if (!VOICE_REFERENCE_LANGUAGES.includes(input.language as VoiceReferenceLanguage)) throw new VoiceReferenceTranscriptionError("请选择中文、英语、日语或韩语。", 400);
    if (!Number.isFinite(input.startSeconds) || input.startSeconds < 0 || input.startSeconds > 86400 || !Number.isFinite(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > 30) throw new VoiceReferenceTranscriptionError("开始时间需为非负数，片段长度需为 1–30 秒。", 400);
    const runtime = await (dependencies.resolveRuntimeImpl ?? resolveRuntime)(input.config);
    check(input.signal, deadline);
    return await withVoxCpm2RuntimeSession(input.config, input.signal, async session => {
      check(input.signal, deadline);
      const scratchRoot = path.join(session.runtimeRoot, "tmp");
      await mkdir(scratchRoot, { recursive: true });
      directory = await mkdtemp(path.join(scratchRoot, "reference-transcription-"));
      const sourcePath = path.join(directory, `source${extension}`), wavPath = path.join(directory, "segment.wav");
      const requestPath = path.join(directory, "request.json"), outputPath = path.join(directory, "result.json");
      await writeFile(sourcePath, input.bytes, { flag: "wx" });
      const spawnImpl: VoiceReferenceTranscriptionSpawn = dependencies.spawnImpl ?? ((command, args, options) => spawn(command, [...args], options));
      const options = { cwd: directory, shell: false as const, windowsHide: true as const, stdio: "ignore" as const, env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PYTHONUTF8: "1" } };
      const run = async (command: string, args: string[], phase: "conversion" | "recognition") => {
        check(input.signal, deadline);
        const child = spawnImpl(command, args, options);
        confirmedExit = false;
        await waitForChild(child, session, { signal: input.signal, timeoutMs: Math.min(phase === "conversion" ? 60_000 : Infinity, Math.max(1, deadline - Date.now())), exitWaitMs: dependencies.exitWaitMs ?? 5_000, phase, onExit: () => {
          confirmedExit = true;
          if (operationFinished && directory) void rm(directory, { recursive: true, force: true }).catch(() => {});
        } });
        check(input.signal, deadline);
      };
      await run(input.config.voiceReferenceFfmpegPath ?? "ffmpeg", buildVoiceReferenceConversionArgs(sourcePath, wavPath, extension, input.startSeconds, input.durationSeconds), "conversion");
      if ((await stat(wavPath)).size > 30 * 16000 * 2 + 65536) throw new VoiceReferenceTranscriptionError("参考片段转换结果异常，请重试。", 422);
      const durationSeconds = validateVoiceReferenceAudio(await readFile(wavPath, { signal: input.signal }), input.durationSeconds);
      await writeFile(requestPath, JSON.stringify({ version: 1, inputWav: wavPath, outputJson: outputPath, modelPath: runtime.modelPath, language: input.language }), { flag: "wx" });
      await run(runtime.pythonPath, [path.resolve(process.cwd(), "scripts", "transcribe-voice-reference.py"), "--request", requestPath], "recognition");
      if ((await stat(outputPath)).size > 16_384) throw new VoiceReferenceTranscriptionError("识别返回内容异常，请重试。", 502);
      const result: unknown = JSON.parse(await readFile(outputPath, "utf8"));
      check(input.signal, deadline);
      if (!result || typeof result !== "object" || !("version" in result) || result.version !== 1 || !("success" in result)) throw new VoiceReferenceTranscriptionError("识别返回内容异常，请重试。", 502);
      if (result.success === false) {
        const code = "code" in result ? result.code : undefined;
        if (code === "no_speech") throw new VoiceReferenceTranscriptionError("没有识别到清晰台词，请换一个人声片段或手动填写。", 422);
        if (code === "invalid_audio") throw new VoiceReferenceTranscriptionError("所选音频片段不可识别，请重新选择。", 422);
        if (code === "runtime_unavailable") throw unavailable();
        throw new VoiceReferenceTranscriptionError("参考文字识别失败，请检查音频并重试。", 502);
      }
      if (result.success !== true || !("transcript" in result) || typeof result.transcript !== "string" || !result.transcript.trim() || result.transcript.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result.transcript) || !("language" in result) || result.language !== input.language) throw new VoiceReferenceTranscriptionError("识别返回内容异常，请重试。", 502);
      return { transcript: result.transcript.trim(), language: input.language as VoiceReferenceLanguage, startSeconds: input.startSeconds, durationSeconds };
    });
  } catch (error) { throw safeError(error, input.signal); }
  finally {
    operationFinished = true;
    if (confirmedExit && directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
