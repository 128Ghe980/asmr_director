import { mkdir, mkdtemp, open, realpath, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { renderConciseH3Prompt } from "./h3-prompt";
import { resolveClipAssetPath } from "./local-asset-store";
import { BatchDownloadError, type PreparedBatchDownload } from "./local-batch-download";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import type { AsmrProject } from "./schema";
import { StoredZipWriter, ZipLimitError } from "./stored-zip";
import { getVideoPackageFilename, getVideoPackageShots, VideoPackageValidationError, type VideoPackageSourceShot } from "./video-package";

export const MAX_VIDEO_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const RUNNER_FILES = ["runner.py", "workflow_api.json", "README.zh.md", "run.bat"] as const;

export type VideoPackageManifest = {
  format: "asmr-video-package";
  version: 1;
  projectId: string;
  title: string;
  workspaceMode: "short" | "paragraph";
  characterReference?: string;
  workflow: "workflow_api.json";
  shots: {
    id: string; order: number; kind: "speech" | "ambient"; referenceMode: "new" | "continuous";
    prompt: string; durationSeconds: number; audio?: string;
  }[];
};
type Dependencies = { reference?: Uint8Array; tempRoot?: string; runnerRoot?: string; maxArchiveBytes?: number };
type AudioSource = { filePath: string; size: number; mtimeMs: number; duration: number };

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new BatchDownloadError("已取消视频项目包导出。", 499);
}

/** File extensions come from bounded file signatures, never the uploaded name or MIME type. */
export function getVideoPackageReferenceExtension(bytes: Uint8Array): "jpg" | "png" | "webp" {
  if (bytes.byteLength > MAX_VIDEO_REFERENCE_BYTES) throw new BatchDownloadError("角色参考图过大（上限 8 MiB）。", 413);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 6 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return "jpg";
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    && view.getUint32(8) === 13 && ascii(12, 4) === "IHDR" && view.getUint32(16) > 0 && view.getUint32(20) > 0) return "png";
  if (bytes.length >= 22 && ascii(0, 4) === "RIFF" && view.getUint32(4, true) === bytes.length - 8
    && ascii(8, 4) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(12, 4))
    && view.getUint32(16, true) > 0 && view.getUint32(16, true) <= bytes.length - 20) return "webp";
  throw new BatchDownloadError("角色参考图须为有效的 JPG、PNG 或 WebP 文件。", 415);
}

function isWithin(root: string, file: string) {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function readBytes(file: FileHandle, offset: number, count: number, signal?: AbortSignal): Promise<Buffer> {
  const bytes = Buffer.alloc(count);
  for (let done = 0; done < count;) {
    checkCancelled(signal);
    const read = await file.read(bytes, done, count - done, offset + done);
    if (!read.bytesRead) throw new Error("Incomplete WAV");
    done += read.bytesRead;
  }
  return bytes;
}

/** Inspect PCM headers in small reads; exporting never allocates a decoded sample buffer. */
async function pcmDuration(file: FileHandle, size: number, signal?: AbortSignal): Promise<number> {
  const header = await readBytes(file, 0, 12, signal);
  if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE"
    || header.readUInt32LE(4) !== size - 8) throw new Error("Invalid WAV header");
  let offset = 12, format: Buffer | undefined, dataBytes: number | undefined;
  while (offset + 8 <= size) {
    const chunk = await readBytes(file, offset, 8, signal);
    const id = chunk.toString("ascii", 0, 4), length = chunk.readUInt32LE(4);
    if (offset + 8 + length > size) throw new Error("Invalid WAV chunk");
    if (id === "fmt ") {
      if (format || length < 16) throw new Error("Invalid WAV format");
      format = await readBytes(file, offset + 8, 16, signal);
    }
    if (id === "data") {
      if (dataBytes !== undefined) throw new Error("Ambiguous WAV data");
      dataBytes = length;
    }
    offset += 8 + length + length % 2;
  }
  if (offset !== size || !format || !dataBytes) throw new Error("Invalid WAV structure");
  const channels = format.readUInt16LE(2), sampleRate = format.readUInt32LE(4);
  const byteRate = format.readUInt32LE(8), blockAlign = format.readUInt16LE(12), bits = format.readUInt16LE(14);
  if (format.readUInt16LE(0) !== 1 || ![1, 2].includes(channels) || ![16, 24].includes(bits)
    || sampleRate < 8000 || sampleRate > 192000 || blockAlign !== channels * bits / 8
    || byteRate !== sampleRate * blockAlign || dataBytes % blockAlign !== 0) throw new Error("Unsupported PCM WAV");
  const duration = dataBytes / blockAlign / sampleRate;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw new Error("Invalid audio duration");
  return duration;
}

async function inspectAudio(entry: VideoPackageSourceShot, config: LocalRuntimeConfig, signal?: AbortSignal): Promise<AudioSource> {
  let file: FileHandle | undefined;
  try {
    const filePath = resolveClipAssetPath(entry.clip.asset.asset_id!, config);
    const [root, resolved] = await Promise.all([realpath(config.clipAssetRoot), realpath(filePath)]);
    if (!isWithin(root, resolved)) throw new BatchDownloadError(`第 ${entry.index} 段的音频路径无效。`, 400);
    file = await open(resolved, "r");
    const before = await file.stat();
    if (!before.isFile()) throw new BatchDownloadError(`第 ${entry.index} 段的已采用音频不可用。`, 404);
    if (before.size > MAX_SOURCE_BYTES) throw new BatchDownloadError(`第 ${entry.index} 段音频过大（上限 128 MiB）。`, 413);
    let duration: number;
    try { duration = await pcmDuration(file, before.size, signal); }
    catch (error) {
      checkCancelled(signal);
      if (error instanceof BatchDownloadError) throw error;
      throw new BatchDownloadError(`第 ${entry.index} 段需要完整有效的 PCM WAV 音频（最长 10 分钟）。`, 422);
    }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new BatchDownloadError(`第 ${entry.index} 段音频正在变化，请稍后导出。`, 409);
    return { filePath: resolved, size: before.size, mtimeMs: before.mtimeMs, duration };
  } catch (error) {
    checkCancelled(signal);
    if (error instanceof BatchDownloadError) throw error;
    throw new BatchDownloadError(`找不到第 ${entry.index} 段的已采用音频，请检查本地素材。`, 404);
  } finally { await file?.close().catch(() => {}); }
}

async function loadRunnerFiles(explicitRoot: string | undefined, signal?: AbortSignal) {
  const configured = explicitRoot ?? process.env.ASMR_VIDEO_RUNNER_ROOT;
  const candidates = configured ? [path.resolve(configured)]
    : [path.resolve(process.cwd(), "tools", "comfy-batch"), path.resolve(process.cwd(), "..", "..", "tools", "comfy-batch")];
  for (const candidate of candidates) {
    try {
      const root = await realpath(candidate);
      const files: { name: string; bytes: Buffer }[] = [];
      for (const name of RUNNER_FILES) {
        checkCancelled(signal);
        const file = await realpath(path.join(root, name));
        if (!isWithin(root, file)) throw new Error("Invalid runner path");
        const handle = await open(file, "r");
        try {
          const info = await handle.stat();
          if (!info.isFile() || !info.size || info.size > 4 * 1024 * 1024) throw new Error("Invalid runner file");
          const bytes = await readBytes(handle, 0, info.size, signal);
          const after = await handle.stat();
          if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error("Runner changed during export");
          files.push({ name, bytes });
        } finally { await handle.close().catch(() => {}); }
      }
      return files;
    } catch { checkCancelled(signal); }
  }
  throw new BatchDownloadError("视频批跑器文件不完整，请配置 ASMR_VIDEO_RUNNER_ROOT 后重试。", 503);
}

async function addAudio(writer: StoredZipWriter, name: string, source: AudioSource, index: number, signal?: AbortSignal) {
  const file = await open(source.filePath, "r");
  try {
    const before = await file.stat();
    if (before.size !== source.size || before.mtimeMs !== source.mtimeMs) throw new BatchDownloadError(`第 ${index} 段音频已变化，请重新导出。`, 409);
    async function* chunks() {
      for (let offset = 0; offset < source.size; offset += 64 * 1024) {
        yield await readBytes(file, offset, Math.min(64 * 1024, source.size - offset), signal);
      }
    }
    await writer.add(name, chunks());
    const after = await file.stat();
    if (after.size !== source.size || after.mtimeMs !== source.mtimeMs) throw new BatchDownloadError(`第 ${index} 段音频已变化，请重新导出。`, 409);
  } finally { await file.close().catch(() => {}); }
}

/** Export one immutable, ordered input snapshot. No DSP, model calls or timeline scheduling. */
export async function prepareVideoPackage(project: AsmrProject, config: LocalRuntimeConfig, signal?: AbortSignal, dependencies: Dependencies = {}): Promise<PreparedBatchDownload> {
  checkCancelled(signal);
  let shots: VideoPackageSourceShot[];
  try { shots = getVideoPackageShots(project); }
  catch (error) {
    if (error instanceof VideoPackageValidationError) throw new BatchDownloadError(error.message, 400);
    throw error;
  }
  if (!shots.length) throw new BatchDownloadError("当前工程还没有可导出的视频镜头。", 400);
  if (shots.length > 2000) throw new BatchDownloadError("视频镜头过多，请分工程导出（每包最多 2000 镜）。", 413);
  const extension = dependencies.reference === undefined ? undefined : getVideoPackageReferenceExtension(dependencies.reference);
  const reference = dependencies.reference === undefined ? undefined : Buffer.from(dependencies.reference);
  const runner = await loadRunnerFiles(dependencies.runnerRoot, signal);
  const sources = new Map<number, AudioSource>();
  let inputBytes = (reference?.length ?? 0) + runner.reduce((sum, file) => sum + file.bytes.length, 0);
  const maxArchiveBytes = dependencies.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
  // Complete preflight happens before any ZIP is created; errors cannot silently omit a shot.
  for (const entry of shots) {
    checkCancelled(signal);
    if (entry.clip.kind !== "silent") {
      const source = await inspectAudio(entry, config, signal);
      sources.set(entry.index, source); inputBytes += source.size;
    }
  }
  if (inputBytes > maxArchiveBytes) throw new BatchDownloadError("视频项目包过大，请分工程导出（每包上限 1 GiB）。", 413);
  const manifest: VideoPackageManifest = {
    format: "asmr-video-package", version: 1, projectId: project.project_id, title: project.title,
    workspaceMode: project.speechWorkspace?.activeMode ?? "short", workflow: "workflow_api.json",
    ...(extension ? { characterReference: `references/character.${extension}` } : {}),
    shots: shots.map(entry => {
      const silent = entry.clip.kind === "silent";
      const durationSeconds = silent ? entry.clip.duration : sources.get(entry.index)!.duration;
      const audio = `shots/${String(entry.index).padStart(3, "0")}/audio.wav`;
      return {
        id: entry.clip.id, order: entry.index, kind: silent ? "ambient" : "speech", referenceMode: entry.referenceMode, durationSeconds,
        prompt: renderConciseH3Prompt({ visual: entry.storyboard.visual, action: entry.storyboard.action, camera: entry.storyboard.camera,
          dialogue: silent ? "" : entry.clip.text, silent, durationSeconds,
          ...(silent ? { ambientSound: entry.storyboard.ambientSound } : {}) }),
        ...(silent ? {} : { audio }),
      };
    }),
  };
  const tempRoot = path.resolve(dependencies.tempRoot ?? process.env.ASMR_BATCH_DOWNLOAD_TEMP_ROOT
    ?? path.join(config.spatialCacheRoot ?? path.join(config.runtimeRoot, "assets", "spatial"), "batch-downloads"));
  await mkdir(tempRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(tempRoot, "video-package-"));
  const filePath = path.join(temporaryDirectory, "video-package.zip");
  const cleanup = async () => {
    if (path.isAbsolute(temporaryDirectory) && path.dirname(temporaryDirectory) === tempRoot) await rm(temporaryDirectory, { recursive: true, force: true });
  };
  let writer: StoredZipWriter | undefined, prepared = false;
  try {
    writer = await StoredZipWriter.create(filePath, maxArchiveBytes, signal);
    await writer.add("project.json", new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
    for (const file of runner) { checkCancelled(signal); await writer.add(file.name, file.bytes); }
    if (reference && manifest.characterReference) await writer.add(manifest.characterReference, reference);
    for (const [position, shot] of manifest.shots.entries()) {
      checkCancelled(signal);
      const folder = `shots/${String(shot.order).padStart(3, "0")}`;
      await writer.add(`${folder}/prompt.txt`, new TextEncoder().encode(shot.prompt));
      if (shot.audio) await addAudio(writer, shot.audio, sources.get(shots[position].index)!, shot.order, signal);
    }
    checkCancelled(signal);
    const size = await writer.finish(); writer = undefined;
    checkCancelled(signal); prepared = true;
    return { filePath, filename: getVideoPackageFilename(project), clipCount: shots.length, size, cleanup };
  } catch (error) {
    checkCancelled(signal);
    if (error instanceof BatchDownloadError) throw error;
    if (error instanceof ZipLimitError) throw new BatchDownloadError("视频项目包过大，请分工程导出（每包上限 1 GiB）。", 413);
    const wrapped = new BatchDownloadError("视频项目包整理失败，请检查本地素材与缓存空间后重试。", 500);
    wrapped.cause = error;
    throw wrapped;
  } finally {
    if (writer) await writer.close().catch(() => {});
    if (!prepared) await cleanup().catch(() => {});
  }
}
