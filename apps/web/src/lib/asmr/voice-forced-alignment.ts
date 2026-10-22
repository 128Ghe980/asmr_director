import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { getVoiceGenerationRoot } from "./voice-generation-recordings";
import { paragraphPcmFrames } from "./voice-paragraph-split";
import type { VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

const SHA = z.string().regex(/^[a-f0-9]{64}$/);
export const ForcedVoiceAlignmentSchema = z.object({
  method: z.literal("ctc_forced"), mode: z.enum(["paragraph", "prefix"]),
  sourceSha256: SHA, inputTextSha256: SHA,
  modelId: z.literal("jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn"),
  modelRevision: z.literal("99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd"),
  sampleRate: z.literal(48_000), sourceFrames: z.number().int().positive().max(48_000 * 120),
  cutFrames: z.array(z.number().int().positive()).max(31),
  characters: z.array(z.object({ char: z.string().min(1).max(2), startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(), score: z.number().finite(), wildcard: z.literal(true).optional() }).strict()).min(1).max(2000),
  contentVerified: z.literal(false),
}).strict();
export type ForcedVoiceAlignment = z.infer<typeof ForcedVoiceAlignmentSchema>;

export class VoiceForcedAlignmentError extends Error {
  constructor(message: string, public readonly statusCode = 422, public readonly diagnosticCode = "forced_alignment_failed") {
    super(message); this.name = "VoiceForcedAlignmentError";
  }
}
type Input = { wav: Uint8Array; clauses: string[]; inputText: string; mode: "paragraph" | "prefix";
  config: LocalRuntimeConfig; signal?: AbortSignal };
type Dependencies = { runtimeSession?: VoxCpm2RuntimeSession; timeoutMs?: number;
  spawnImpl?: typeof spawn; pythonPath?: string; modelPath?: string };
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const invalid = () => new VoiceForcedAlignmentError("强制对齐没有返回有效的切分时间，原音已保留。", 422, "invalid_forced_timing");
const cancelled = () => new VoiceForcedAlignmentError("强制切分已取消，原音已保留。", 499, "cancelled");

/** Check file identity and executable frame boundaries, never text/score/quiet quality. */
export function validateForcedVoiceAlignment(value: unknown, input: Pick<Input, "wav" | "clauses" | "inputText" | "mode">): ForcedVoiceAlignment {
  const parsed = ForcedVoiceAlignmentSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const result = parsed.data;
  const { frames } = paragraphPcmFrames(input.wav);
  const count = input.mode === "paragraph" ? input.clauses.length - 1 : 1;
  if (result.mode !== input.mode || result.sourceSha256 !== sha(input.wav) || result.inputTextSha256 !== sha(input.inputText)
    || result.sourceFrames !== frames || result.cutFrames.length !== count
    || result.cutFrames.some((frame, index) => frame >= frames || (index > 0 && frame <= result.cutFrames[index - 1]))) throw invalid();
  let previous = 0;
  for (const character of result.characters) {
    if (character.startSeconds < previous - 1e-6 || character.endSeconds <= character.startSeconds
      || character.endSeconds > frames / 48_000 + 1e-6) throw invalid();
    previous = character.endSeconds;
  }
  // Normalization only removes formatting/punctuation and keeps a one-to-one
  // simplified-character map. Verify the executed cuts bind the reported CTC
  // sentence boundaries, allowing one PCM frame for language rounding rules.
  const length = (text: string) => Array.from(text).filter(character => !/[\s\p{P}~～]/u.test(character)).length;
  const clauseLengths = input.clauses.map(length);
  if (clauseLengths.some(value => value === 0)) throw invalid();
  let offset = 0;
  const boundaries = input.mode === "prefix" ? [clauseLengths[0]] : clauseLengths.slice(0, -1).map(value => (offset += value));
  if (input.mode === "paragraph" && result.characters.length !== clauseLengths.reduce((sum, value) => sum + value, 0)) throw invalid();
  for (const [index, boundary] of boundaries.entries()) {
    const left = result.characters[boundary - 1], right = result.characters[boundary];
    if (!left || !right || Math.abs(result.cutFrames[index] - Math.round((left.endSeconds + right.startSeconds) * 24_000)) > 1) throw invalid();
  }
  return result;
}

async function waitForAlignment(child: ChildProcess, signal: AbortSignal | undefined, timeoutMs: number,
  onClosed: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false, stopping: VoiceForcedAlignmentError | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(exitTimer);
      signal?.removeEventListener("abort", abort); if (error) reject(error); else resolve();
    };
    const stop = (error: VoiceForcedAlignmentError) => {
      if (stopping || settled) return; stopping = error;
      child.kill();
      exitTimer = setTimeout(() => finish(error), 5_000);
    };
    const abort = () => stop(cancelled());
    const timer = setTimeout(() => stop(new VoiceForcedAlignmentError("强制切分超时，原音已保留。", 504, "timeout")), timeoutMs);
    child.once("close", (code) => { onClosed(); finish(stopping ?? (code === 0 ? undefined
      : new VoiceForcedAlignmentError("强制对齐程序未能完成，原音已保留。", 503, "alignment_process_failed"))); });
    child.once("error", () => {
      if (!child.pid) { onClosed(); finish(new VoiceForcedAlignmentError("强制对齐运行环境不可用。", 503, "alignment_unavailable")); }
      else stop(new VoiceForcedAlignmentError("强制对齐程序运行异常。", 503, "alignment_process_failed"));
    });
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    // Discard native output; file protocol carries bounded user-facing diagnostics.
    child.stdout?.resume(); child.stderr?.resume();
  });
}

export async function forceAlignVoiceAudio(input: Input, dependencies: Dependencies = {}): Promise<ForcedVoiceAlignment> {
  if (input.signal?.aborted) throw cancelled();
  if (!input.inputText.trim() || input.inputText.length > 2000 || !input.clauses.length || input.clauses.length > 32
    || input.clauses.some(clause => !clause.trim()) || (input.mode === "prefix" && input.clauses.length !== 1)) throw invalid();
  paragraphPcmFrames(input.wav);
  const pythonPath = dependencies.pythonPath ?? input.config.voiceAlignmentPythonPath ?? input.config.voiceAnalysisPythonPath
    ?? path.join(input.config.runtimeRoot, "engines", "gpt-sovits", "env-comfyui-clone", "python.exe");
  const modelPath = dependencies.modelPath ?? input.config.voiceAlignmentModelPath
    ?? path.join(input.config.runtimeRoot, "audio-quality-v1", "forced-alignment", "model");
  const helperPaths = [path.resolve("scripts", "force-align-voice.py"), path.resolve("apps", "web", "scripts", "force-align-voice.py")];
  const helper = (await Promise.all(helperPaths.map(async candidate => (await stat(candidate).catch(() => undefined))?.isFile() ? candidate : undefined))).find(Boolean);
  if (!helper || !(await stat(pythonPath).catch(() => undefined))?.isFile()
    || !(await stat(path.join(modelPath, "config.json")).catch(() => undefined))?.isFile()) {
    throw new VoiceForcedAlignmentError("强制对齐模型或运行环境尚未就绪，原音已保留。", 503, "alignment_unavailable");
  }
  const root = path.join(getVoiceGenerationRoot(input.config), "forced-alignment-runs");
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root), directory = await mkdtemp(path.join(canonicalRoot, "force-"));
  let closed = true;
  try {
    const inputWav = path.join(directory, "input.wav"), outputJson = path.join(directory, "result.json"), requestPath = path.join(directory, "request.json");
    await writeFile(inputWav, input.wav);
    await writeFile(requestPath, JSON.stringify({ version: 1, inputWav, outputJson, modelPath,
      mode: input.mode, clauses: input.clauses, inputText: input.inputText }), "utf8");
    if (input.signal?.aborted) throw cancelled();
    const child = (dependencies.spawnImpl ?? spawn)(pythonPath, ["-B", helper, "--request", requestPath], {
      windowsHide: true, cwd: directory, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PYTHONDONTWRITEBYTECODE: "1", TEMP: directory, TMP: directory },
    });
    closed = false;
    dependencies.runtimeSession?.processStarted(child.pid);
    await waitForAlignment(child, input.signal, dependencies.timeoutMs ?? 10 * 60 * 1000, () => {
      closed = true; void dependencies.runtimeSession?.processExited(child.pid);
    });
    if (input.signal?.aborted) throw cancelled();
    if ((await stat(outputJson)).size > 1024 * 1024) throw invalid();
    const raw = JSON.parse(await readFile(outputJson, "utf8"));
    if (raw?.success === false) {
      const code = typeof raw.code === "string" && /^[a-z_]{1,100}$/.test(raw.code) ? raw.code : "forced_alignment_failed";
      const reason = code === "oov_characters" ? "对齐模型不支持文案中的部分字符，无法计算其时间。"
        : code === "insufficient_ctc_frames" ? "音频没有足够的声学帧来定位这些句子。" : "强制对齐未能计算出有效时间，原音已保留。";
      throw new VoiceForcedAlignmentError(reason, 422, code);
    }
    const { version, success, ...result } = raw ?? {};
    if (version !== 1 || success !== true) throw invalid();
    return validateForcedVoiceAlignment(result, input);
  } catch (error) {
    if (error instanceof VoiceForcedAlignmentError) throw error;
    throw new VoiceForcedAlignmentError("强制切分未能完成，原音已保留。", 503, "alignment_unavailable");
  } finally {
    if (closed) {
      const resolved = await realpath(directory).catch(() => undefined);
      if (resolved && path.dirname(resolved) === canonicalRoot && path.basename(resolved).startsWith("force-")) {
        await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  }
}
