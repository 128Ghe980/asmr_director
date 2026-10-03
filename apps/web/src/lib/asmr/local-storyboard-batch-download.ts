import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { BatchDownloadError, type PreparedBatchDownload } from "./local-batch-download";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import type { AsmrProject } from "./schema";
import { getBatchStoryboardClips, getBatchStoryboardDownloadFilename, getBatchStoryboardDownloadFolderName } from "./storyboard-batch-download";
import { StoredZipWriter, ZipLimitError } from "./stored-zip";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_CLIPS = 2000;
type Dependencies = { tempRoot?: string; maxArchiveBytes?: number };

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new BatchDownloadError("已取消批量下载。", 499);
}

/** Export existing usable prompts only; no audio file reads, processing or model calls. */
export async function prepareStoryboardBatchDownload(
  project: AsmrProject,
  config: LocalRuntimeConfig,
  signal?: AbortSignal,
  dependencies: Dependencies = {},
): Promise<PreparedBatchDownload> {
  checkCancelled(signal);
  const clips = getBatchStoryboardClips(project);
  if (!clips.length) throw new BatchDownloadError("当前工程还没有可导出的分镜，请先生成或更新分镜。", 400);
  if (clips.length > MAX_CLIPS) throw new BatchDownloadError("分镜过多，请分工程下载（每包最多 2000 段）。", 413);
  const maxArchiveBytes = dependencies.maxArchiveBytes ?? MAX_ARCHIVE_BYTES;
  const tempRoot = path.resolve(dependencies.tempRoot ?? process.env.ASMR_BATCH_DOWNLOAD_TEMP_ROOT
    ?? path.join(config.spatialCacheRoot ?? path.join(config.runtimeRoot, "assets", "spatial"), "batch-downloads"));
  await mkdir(tempRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(tempRoot, "download-"));
  const filePath = path.join(temporaryDirectory, "storyboard.zip");
  const cleanup = async () => {
    // Only this generated child directory is removable, never the configured root.
    if (path.dirname(temporaryDirectory) === tempRoot) await rm(temporaryDirectory, { recursive: true, force: true });
  };
  let writer: StoredZipWriter | undefined;
  let prepared = false;
  try {
    writer = await StoredZipWriter.create(filePath, maxArchiveBytes, signal);
    const folder = getBatchStoryboardDownloadFolderName(project);
    for (const entry of clips) {
      checkCancelled(signal);
      await writer.add(`${folder}/${entry.filename}`, new TextEncoder().encode(entry.prompt));
    }
    checkCancelled(signal);
    const size = await writer.finish();
    writer = undefined;
    checkCancelled(signal);
    prepared = true;
    return { filePath, filename: getBatchStoryboardDownloadFilename(project), clipCount: clips.length, size, cleanup };
  } catch (error) {
    if (signal?.aborted) throw new BatchDownloadError("已取消批量下载。", 499);
    if (error instanceof BatchDownloadError) throw error;
    if (error instanceof ZipLimitError) throw new BatchDownloadError("分镜包过大，请分工程下载（每包上限 64 MiB）。", 413);
    throw new BatchDownloadError("批量分镜整理失败，请检查缓存空间后重试。", 500);
  } finally {
    if (writer) await writer.close().catch(() => {});
    if (!prepared) await cleanup().catch(() => {});
  }
}
