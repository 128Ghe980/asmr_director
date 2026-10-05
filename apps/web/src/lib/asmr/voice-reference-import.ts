import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./pcm-audio";
import { resolveVoxCpm2ProfilePath, type VoiceReferenceMode } from "./voice-provider-catalog";
import { loadVoxCpm2Profile, normalizeVoxCpm2Transcript, parseVoxCpm2ProfileFile, selectVoxCpm2Reference } from "./voxcpm2-profile";

export const MAX_VOICE_REFERENCE_BYTES = 32 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 30 * 16000 * 2 + 65536;

export class VoiceReferenceImportError extends Error {
  constructor(message: string, readonly statusCode = 500) { super(message); }
}

export type VoiceReferenceImportInput = {
  bytes: Uint8Array;
  filename: string;
  name: string;
  promptText?: string;
  startSeconds: number;
  durationSeconds: number;
  config: LocalRuntimeConfig;
  signal?: AbortSignal;
};
export type ImportedVoiceReference = {
  id: string;
  label: string;
  referenceModes: VoiceReferenceMode[];
  audioUrl: string;
  durationSeconds: number;
};
type NativeChild = {
  pid?: number;
  stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};
export type VoiceReferenceSpawn = (command: string, args: readonly string[], options: {
  cwd: string; shell: false; windowsHide: true; stdio: ["ignore", "ignore", "pipe"];
}) => NativeChild;
type ImportDependencies = { spawnImpl?: VoiceReferenceSpawn; timeoutMs?: number; exitWaitMs?: number; lockWaitMs?: number };

function cancelled() { return new VoiceReferenceImportError("已取消添加参考声音。", 499); }
function checkCancelled(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }
function storageError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "ENOSPC" || code === "EDQUOT" ? new VoiceReferenceImportError("存储空间不足，参考声音未添加，请释放空间后重试。", 507) : undefined;
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => {}); }
}

export function validateVoiceReferenceAudio(bytes: Uint8Array, expectedDuration?: number) {
  try {
    const decoded = decodePcmWav(bytes);
    let bits = 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) === "fmt ") bits = view.getUint16(offset + 22, true);
      offset += 8 + size + size % 2;
    }
    if (decoded.sampleRate !== 16000 || decoded.channels !== 1 || bits !== 16 || !decoded.samples.length) throw new Error("Invalid normalization");
    let nonzero = false;
    for (const sample of decoded.samples) { if (!Number.isFinite(sample)) throw new Error("Invalid samples"); if (sample !== 0) nonzero = true; }
    if (!nonzero) throw new VoiceReferenceImportError("所选片段没有有效声音，请换一个有清晰人声的片段。", 422);
    const durationSeconds = decoded.samples.length / decoded.sampleRate;
    if (expectedDuration !== undefined && Math.abs(durationSeconds - expectedDuration) > 0.1) throw new VoiceReferenceImportError("音频不足所选片段长度，请缩短时长或调整开始时间。", 422);
    return durationSeconds;
  } catch (error) {
    if (error instanceof VoiceReferenceImportError) throw error;
    throw new VoiceReferenceImportError("音频无法转换为有效参考声音，请使用可播放的 MP3 或 WAV。", 422);
  }
}

/** Shared bounded local-only conversion for import and selected-segment ASR. */
export function buildVoiceReferenceConversionArgs(sourcePath: string, outputPath: string, extension: ".mp3" | ".wav", startSeconds: number, durationSeconds: number): string[] {
  return ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-protocol_whitelist", "file,pipe", "-f", extension.slice(1), "-i", sourcePath, "-ss", String(startSeconds), "-t", String(durationSeconds), "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-threads", "1", outputPath];
}

function waitForConversion(child: NativeChild, signal: AbortSignal | undefined, timeoutMs: number, exitWaitMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false, stopping: VoiceReferenceImportError | undefined;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    let log = "";
    child.stderr?.on("data", (chunk: Buffer | string) => { log = (log + chunk.toString()).slice(-8192); });
    const finish = (error?: VoiceReferenceImportError) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(exitTimer); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const stop = (error: VoiceReferenceImportError) => {
      if (settled || stopping) return;
      stopping = error;
      exitTimer = setTimeout(() => finish(new VoiceReferenceImportError("音频转换进程尚未停止，请稍后再试。", 503)), exitWaitMs);
      try { child.kill("SIGKILL"); } catch { /* Do not publish while a child may still write. */ }
    };
    const abort = () => stop(cancelled());
    const timer = setTimeout(() => stop(new VoiceReferenceImportError("音频转换超时，请使用较短的音频后重试。", 504)), timeoutMs);
    child.once("error", error => {
      const unavailable = new VoiceReferenceImportError("无法启动音频转换，请检查本机 FFmpeg 配置。", 503);
      if (!child.pid) finish(storageError(error) ?? unavailable); else stop(unavailable);
    });
    child.once("close", code => finish(stopping ?? (code === 0 ? undefined : new VoiceReferenceImportError(/No space left|disk.*full/i.test(log) ? "存储空间不足，参考声音未添加，请释放空间后重试。" : "音频转换失败，请使用可播放的 MP3 或 WAV。", /No space left|disk.*full/i.test(log) ? 507 : 422))));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function delay(milliseconds: number, signal?: AbortSignal) {
  checkCancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(cancelled()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** A filesystem lock serializes all writers, including different server processes. */
async function appendReference(manifestPath: string, reference: ReturnType<typeof parseVoxCpm2ProfileFile>["references"][number], signal?: AbortSignal, lockWaitMs = 10000) {
  const lockPath = `${manifestPath}.reference-import.lock`;
  const deadline = Date.now() + lockWaitMs;
  let lock: Awaited<ReturnType<typeof open>>;
  let lockCleanupNeeded = false;
  for (;;) {
    checkCancelled(signal);
    try { lock = await open(lockPath, "wx"); break; }
    catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new VoiceReferenceImportError("参考声音列表正在保存，请稍后重试。", 503);
      await delay(40, signal);
    }
  }
  try {
    // Read fresh inside the lock; never save the earlier readiness snapshot.
    const original = await readFile(manifestPath, "utf8");
    if (original.length > 100000) throw new Error("Profile too large");
    const profile = parseVoxCpm2ProfileFile(JSON.parse(original));
    if (profile.references.length >= 40) throw new VoiceReferenceImportError("参考声音已达 40 个上限。", 409);
    const updated = parseVoxCpm2ProfileFile({ ...profile, references: [...profile.references, reference] });
    const serialized = `${JSON.stringify(updated, null, 2)}\n`;
    if (serialized.length > 100000) throw new VoiceReferenceImportError("参考声音配置已达容量上限。", 409);
    checkCancelled(signal);
    // Every real write has a complete immutable backup, and the old file stays
    // readable until a fully written replacement is atomically renamed.
    await writeFile(`${manifestPath}.before-reference-${reference.id}.bak`, original, { flag: "wx" });
    const temporary = `${manifestPath}.${reference.id}.tmp`;
    try {
      await writeFile(temporary, serialized, { flag: "wx" });
      checkCancelled(signal);
      await rename(temporary, manifestPath);
    } finally { await unlink(temporary).catch(() => {}); }
  } finally {
    // A lock-cleanup failure after rename must never turn a saved reference into
    // an apparent failed upload. Retain the recovery flag in server provenance.
    await lock.close().catch(() => { lockCleanupNeeded = true; });
    await unlink(lockPath).catch(() => { lockCleanupNeeded = true; });
  }
  return lockCleanupNeeded;
}

export async function importVoiceReference(input: VoiceReferenceImportInput, dependencies: ImportDependencies = {}): Promise<ImportedVoiceReference> {
  const { config, signal } = input;
  checkCancelled(signal);
  const extension = path.extname(input.filename).toLowerCase();
  if (![".mp3", ".wav"].includes(extension)) throw new VoiceReferenceImportError("请上传 MP3 或 WAV 音频。", 415);
  if (!input.bytes.byteLength) throw new VoiceReferenceImportError("请上传非空音频文件。", 400);
  if (input.bytes.byteLength > MAX_VOICE_REFERENCE_BYTES) throw new VoiceReferenceImportError("音频文件过大（上限 32 MB）。", 413);
  const label = input.name.trim(), rawTranscript = input.promptText?.trim() ?? "";
  const transcript = normalizeVoxCpm2Transcript(rawTranscript) ? rawTranscript : "";
  if (!label || label.length > 100 || /[\u0000-\u001f\u007f]/.test(label)) throw new VoiceReferenceImportError("请输入 1–100 字的参考声音名称。", 400);
  if (rawTranscript.length > 2000) throw new VoiceReferenceImportError("参考文案最多 2000 字，请填写实际台词或留空。", 400);
  if (!Number.isFinite(input.startSeconds) || input.startSeconds < 0 || input.startSeconds > 86400 || !Number.isFinite(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > 30) throw new VoiceReferenceImportError("开始时间需为非负数，片段长度需为 1–30 秒。", 400);
  const manifestPath = path.resolve(resolveVoxCpm2ProfilePath(config));
  try { await loadVoxCpm2Profile(manifestPath); }
  catch { throw new VoiceReferenceImportError("VoxCPM2 配置不可用，请先检查本机模型配置。", 503); }
  checkCancelled(signal);
  const id = `user-${randomUUID()}`;
  const root = path.resolve(config.voiceReferenceRoot ?? path.join(path.dirname(manifestPath), "references", "imported"));
  const directory = path.join(root, id);
  const originalPath = path.join(directory, `source${extension}`), outputPath = path.join(directory, "reference.wav"), metadataPath = path.join(directory, "provenance.json");
  const createdAt = new Date().toISOString();
  const provenance = { version: 1, id, displayName: label, source: "user_upload", originalFilename: path.basename(input.filename), originalSha256: createHash("sha256").update(input.bytes).digest("hex"), originalBytes: input.bytes.byteLength, selectedStartSeconds: input.startSeconds, selectedDurationSeconds: input.durationSeconds, createdAt, consentConfirmedAt: createdAt, hasUserTranscript: Boolean(transcript), normalization: { sampleRate: 16000, channels: 1, format: "PCM16" } };
  let sourceSaved = false, published = false;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(originalPath, input.bytes, { flag: "wx" }); sourceSaved = true;
    await atomicJson(metadataPath, { ...provenance, status: "converting" });
    checkCancelled(signal);
    const spawnImpl: VoiceReferenceSpawn = dependencies.spawnImpl ?? ((command, args, options) => spawn(command, [...args], options));
    const child = spawnImpl(config.voiceReferenceFfmpegPath ?? "ffmpeg", buildVoiceReferenceConversionArgs(originalPath, outputPath, extension as ".mp3" | ".wav", input.startSeconds, input.durationSeconds), { cwd: directory, shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    await waitForConversion(child, signal, dependencies.timeoutMs ?? 60000, dependencies.exitWaitMs ?? 5000);
    checkCancelled(signal);
    if ((await stat(outputPath)).size > MAX_NORMALIZED_BYTES) throw new VoiceReferenceImportError("参考片段转换结果异常，请重试。", 422);
    const wav = await readFile(outputPath, { signal });
    const durationSeconds = validateVoiceReferenceAudio(wav, input.durationSeconds);
    const promptPath = transcript ? path.join(directory, "reference.txt") : null;
    if (promptPath) await writeFile(promptPath, `${transcript}\n`, { flag: "wx" });
    await atomicJson(metadataPath, { ...provenance, status: "prepared", durationSeconds, normalizedSha256: createHash("sha256").update(wav).digest("hex") });
    const lockCleanupNeeded = await appendReference(manifestPath, { id, displayName: label, audioPath: outputPath, promptTextPath: promptPath, licenseStatus: "user_confirmed", consentConfirmedAt: createdAt, durationSeconds, provenancePath: metadataPath }, signal, dependencies.lockWaitMs);
    published = true;
    // The atomic profile append is the commit point. Cancellation arriving later
    // must not report the successfully saved reference as failed.
    await atomicJson(metadataPath, { ...provenance, status: "imported", durationSeconds, normalizedSha256: createHash("sha256").update(wav).digest("hex"), ...(lockCleanupNeeded ? { profileLockCleanupNeeded: true } : {}) }).catch(() => {});
    return { id, label, referenceModes: transcript ? ["reference_only", "with_reference_text"] : ["reference_only"], audioUrl: `/api/voice-references/${id}/audio`, durationSeconds };
  } catch (error) {
    const safe = error instanceof VoiceReferenceImportError ? error : signal?.aborted ? cancelled() : storageError(error) ?? new VoiceReferenceImportError("参考声音未能保存，请检查本机存储与配置后重试。", 500);
    if (sourceSaved && !published) await atomicJson(metadataPath, { ...provenance, status: safe.statusCode === 499 ? "cancelled" : "failed", error: safe.message }).catch(() => {});
    throw safe;
  }
}

export async function readVoiceReferenceAudio(id: string, config: LocalRuntimeConfig, signal?: AbortSignal): Promise<Uint8Array> {
  checkCancelled(signal);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new VoiceReferenceImportError("参考声音编号无效。", 400);
  let reference;
  try { reference = selectVoxCpm2Reference(await loadVoxCpm2Profile(resolveVoxCpm2ProfilePath(config)), id); }
  catch { throw new VoiceReferenceImportError("参考声音不可用，请刷新列表后重试。", 404); }
  try {
    const info = await stat(reference.audioPath);
    if (!info.isFile() || info.size > MAX_VOICE_REFERENCE_BYTES) throw new Error("Invalid audio");
    const bytes = await readFile(reference.audioPath, { signal });
    validateVoiceReferenceAudio(bytes);
    checkCancelled(signal);
    return new Uint8Array(bytes);
  } catch { checkCancelled(signal); throw new VoiceReferenceImportError("参考音频暂时无法试听，请检查本机文件。", 503); }
}
