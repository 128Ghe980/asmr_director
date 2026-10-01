import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getBatchDownloadClips, getBatchDownloadFilename, getBatchDownloadFolderName } from "./batch-download";
import { resolveClipAssetPath } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { renderProcessedClipWav } from "./project-mix-renderer";
import type { AsmrProject } from "./schema";
import { MAX_SPATIAL_DURATION_SECONDS, renderSpatialClip, SpatialAudioError, type SpatialClipResult } from "./spatial-audio";
import { StoredZipWriter, ZipLimitError } from "./stored-zip";

const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_CLIPS = 2000;

export class BatchDownloadError extends Error {
  constructor(message: string, public readonly statusCode = 500) {
    super(message);
    this.name = "BatchDownloadError";
  }
}

type Dependencies = {
  tempRoot?: string;
  maxArchiveBytes?: number;
  renderSpatial?: typeof renderSpatialClip;
};

export type PreparedBatchDownload = {
  filePath: string;
  filename: string;
  clipCount: number;
  size: number;
  cleanup: () => Promise<void>;
};

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new BatchDownloadError("已取消批量下载。", 499);
}

async function checkedAssetPath(assetId: string, config: LocalRuntimeConfig) {
  let filePath: string;
  try { filePath = resolveClipAssetPath(assetId, config); }
  catch { throw new BatchDownloadError("已采用音频的素材编号无效。", 400); }
  try {
    const [resolvedRoot, resolvedFile, info] = await Promise.all([
      realpath(config.clipAssetRoot), realpath(filePath), stat(filePath),
    ]);
    if (!resolvedFile.startsWith(resolvedRoot + path.sep)) throw new BatchDownloadError("已采用音频的素材路径无效。", 400);
    if (!info.isFile()) throw new BatchDownloadError("已采用的音频文件不可用。", 404);
    if (info.size > MAX_SOURCE_BYTES) throw new BatchDownloadError("已采用的单段音频过大（上限 128 MiB）。", 413);
    return { filePath, size: info.size };
  } catch (error) {
    if (error instanceof BatchDownloadError) throw error;
    throw new BatchDownloadError("找不到已采用的音频文件，请检查本地素材。", 404);
  }
}

function inspectSource(wav: Uint8Array, spatialized = false) {
  try {
    // Read metadata without allocating another complete decoded PCM buffer.
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const ascii = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
    if (wav.length < 44 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") throw new Error("Invalid WAV");
    let channels = 0, sampleRate = 0, blockAlign = 0, dataSize = 0, format = 0, bits = 0;
    for (let offset = 12; offset + 8 <= wav.length;) {
      const id = ascii(offset), size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > wav.length) throw new Error("Invalid WAV chunk");
      if (id === "fmt ") {
        if (size < 16) throw new Error("Invalid WAV format");
        format = view.getUint16(start, true); channels = view.getUint16(start + 2, true);
        sampleRate = view.getUint32(start + 4, true); blockAlign = view.getUint16(start + 12, true); bits = view.getUint16(start + 14, true);
      }
      if (id === "data") dataSize = size;
      offset = start + size + size % 2;
    }
    if (![1, 2].includes(channels) || format !== 1 || ![16, 24].includes(bits)
      || sampleRate < 8000 || sampleRate > 192000 || blockAlign !== channels * bits / 8 || !dataSize || dataSize % blockAlign) throw new Error("Unsupported WAV");
    const duration = dataSize / blockAlign / sampleRate;
    if (duration > MAX_SPATIAL_DURATION_SECONDS + (spatialized ? .65 : 0)) throw new BatchDownloadError("批量下载暂支持每段最长 10 分钟的音频。", 413);
    return { duration, channels };
  } catch (error) {
    if (error instanceof BatchDownloadError) throw error;
    throw new BatchDownloadError("已采用的素材需要有效的 PCM WAV 音频。", 422);
  }
}

/** Prepare the complete ZIP first so processing failures return readable JSON, not a broken download. */
export async function prepareBatchDownload(
  project: AsmrProject,
  config: LocalRuntimeConfig,
  signal?: AbortSignal,
  dependencies: Dependencies = {},
): Promise<PreparedBatchDownload> {
  checkCancelled(signal);
  for (const track of project.timeline.tracks) for (const clip of track.clips) {
    if (clip.generation.status === "asset_generated" && clip.asset.uri?.startsWith("asset://clip/")
      && clip.asset.uri !== `asset://clip/${clip.asset.asset_id}`) {
      throw new BatchDownloadError("已采用音频的素材引用不一致。", 400);
    }
  }
  const clips = getBatchDownloadClips(project);
  if (!clips.length) throw new BatchDownloadError("当前工程还没有已生成并采用的音频。", 400);
  if (clips.length > MAX_CLIPS) throw new BatchDownloadError("音频片段过多，请分工程下载（每包最多 2000 段）。", 413);
  const maxArchiveBytes = dependencies.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
  const sources: Awaited<ReturnType<typeof checkedAssetPath>>[] = [];
  let minimumBytes = 0;
  for (const entry of clips) {
    checkCancelled(signal);
    const source = await checkedAssetPath(entry.assetId, config);
    minimumBytes += source.size;
    if (minimumBytes > maxArchiveBytes) throw new BatchDownloadError("音频包过大，请分工程下载（每包上限 1 GiB）。", 413);
    sources.push(source);
  }

  const tempRoot = path.resolve(dependencies.tempRoot ?? process.env.ASMR_BATCH_DOWNLOAD_TEMP_ROOT
    ?? path.join(config.spatialCacheRoot ?? path.join(config.runtimeRoot, "assets", "spatial"), "batch-downloads"));
  await mkdir(tempRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(tempRoot, "download-"));
  const filePath = path.join(temporaryDirectory, "audio.zip");
  const cleanup = async () => {
    // The deletion target is the verified single generated directory, never an asset root.
    if (temporaryDirectory.startsWith(tempRoot + path.sep)) await rm(temporaryDirectory, { recursive: true, force: true });
  };
  let writer: StoredZipWriter | undefined;
  let prepared = false;
  try {
    writer = await StoredZipWriter.create(filePath, maxArchiveBytes, signal);
    const folder = getBatchDownloadFolderName(project);
    const manifest = {
      version: 1, projectId: project.project_id, title: project.title,
      clipCount: clips.length, binaural: project.timeline.mixing.binaural,
      notes: [
        "仅包含当前工程已生成并采用的片段，不含未采用候选、原始生成长窗口、历史版本或整段混音。",
        "无后处理保留已采用素材的完整原始 WAV 字节；后处理保留完整源时长，人声双耳处理另保留 650 ms 房间尾声。",
        "后处理使用当前片段音量、淡入淡出与适用的空间位置设置；不加工程主响度归一或整段混音限幅，也不按时间线裁短或重复音频。",
      ],
      clips: [] as {
        clipId: string; assetId: string; type: string; startSeconds: number;
        rawPath: string; processedPath: string; processing: string; spatialized: boolean;
        durationSeconds: number; processingNote: string;
        settings: { volumeDb: number; fadeInSeconds: number; fadeOutSeconds: number; position: typeof clips[number]["clip"]["position"] };
      }[],
    };
    for (const [index, entry] of clips.entries()) {
      checkCancelled(signal);
      const rawPath = `${folder}/无后处理/${entry.filename}`;
      const processedPath = `${folder}/后处理/${entry.filename}`;
      const originalStream = createReadStream(sources[index].filePath, { signal });
      try { await writer.add(rawPath, originalStream); }
      finally { originalStream.destroy(); }
      checkCancelled(signal);
      const clip = entry.clip;
      let loaded: SpatialClipResult;
      let processing: string, processingNote: string;
      if (clip.type === "voice" && project.timeline.mixing.binaural) {
        loaded = await (dependencies.renderSpatial ?? renderSpatialClip)({
          assetId: entry.assetId, position: clip.position,
          fadeInSeconds: clip.fade_in, fadeOutSeconds: clip.fade_out, config, signal,
        });
        if (!loaded.spatialized) {
          const original = inspectSource(loaded.wav);
          if (original.channels !== 2) throw new BatchDownloadError("人声空间处理未完成，请检查本机空间处理环境后重试。", 503);
        }
        processing = loaded.spatialized ? "original_d_binaural" : "stereo_source";
        processingNote = loaded.spatialized ? "原 D 双耳空间处理，保留完整 650 ms 尾声，并应用片段音量。"
          : "源文件已为立体声，保留原双声道，不重复双耳空间处理；应用片段音量与淡入淡出。";
      } else {
        loaded = { wav: await readFile(sources[index].filePath, { signal }), spatialized: false };
        processing = "basic_processing";
        processingNote = clip.type === "voice" ? "工程双耳处理关闭；应用音量、淡入淡出与适用的单声道声像/距离/运动设置。"
          : "应用音量、淡入淡出与适用的单声道声像/距离/运动设置；不使用人声 D 双耳处理。";
      }
      checkCancelled(signal);
      // D appends 650 ms; all other files keep their real source duration.
      const duration = inspectSource(loaded.wav, loaded.spatialized).duration;
      const processed = await renderProcessedClipWav({ ...clip, start: 0, duration }, loaded, signal);
      await writer.add(processedPath, processed);
      manifest.clips.push({
        clipId: clip.id, assetId: entry.assetId, type: clip.type, startSeconds: clip.start,
        rawPath, processedPath, processing, spatialized: loaded.spatialized,
        durationSeconds: duration, processingNote,
        settings: { volumeDb: clip.volume_db, fadeInSeconds: clip.fade_in, fadeOutSeconds: clip.fade_out, position: clip.position },
      });
    }
    checkCancelled(signal);
    await writer.add(`${folder}/导出清单.json`, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
    const size = await writer.finish();
    writer = undefined;
    checkCancelled(signal);
    prepared = true;
    return { filePath, filename: getBatchDownloadFilename(project), clipCount: clips.length, size, cleanup };
  } catch (error) {
    if (signal?.aborted) throw new BatchDownloadError("已取消批量下载。", 499);
    if (error instanceof BatchDownloadError) throw error;
    if (error instanceof SpatialAudioError) throw new BatchDownloadError(error.message, error.statusCode);
    if (error instanceof ZipLimitError) throw new BatchDownloadError(error.message, 413);
    throw new BatchDownloadError("批量音频整理失败，请检查本地素材与缓存空间后重试。", 500);
  } finally {
    if (writer) await writer.close().catch(() => {});
    if (!prepared) await cleanup().catch(() => {});
  }
}
