import { randomUUID } from "node:crypto";
import { BatchDownloadError, type PreparedBatchDownload } from "./local-batch-download";

export const BATCH_DOWNLOAD_TTL_MS = 5 * 60 * 1000;
const MAX_READY_DOWNLOADS = 2;
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Session = { archive: PreparedBatchDownload; expiresAt: number; timer: ReturnType<typeof setTimeout> };
const processState = globalThis as typeof globalThis & { __asmrPreparedBatchDownloads?: Map<string, Session> };
const sessions = processState.__asmrPreparedBatchDownloads ??= new Map<string, Session>();

/** A prepared archive is released once, whether expired, canceled or consumed. */
export function ownPreparedBatchDownload(archive: PreparedBatchDownload): PreparedBatchDownload {
  let cleanup: Promise<void> | undefined;
  return { ...archive, cleanup: () => cleanup ??= Promise.resolve().then(() => archive.cleanup()) };
}

export function assertBatchDownloadCapacity() {
  if (sessions.size >= MAX_READY_DOWNLOADS) throw new BatchDownloadError("已有待下载的文件包，请先下载或稍后再试。", 429);
}

export function registerBatchDownload(archive: PreparedBatchDownload): string {
  assertBatchDownloadCapacity();
  const token = randomUUID();
  const timer = setTimeout(() => {
    const session = sessions.get(token);
    if (!session) return;
    sessions.delete(token);
    void session.archive.cleanup().catch(() => {});
  }, BATCH_DOWNLOAD_TTL_MS);
  timer.unref();
  sessions.set(token, { archive, expiresAt: Date.now() + BATCH_DOWNLOAD_TTL_MS, timer });
  return `/api/assets/batch-download?token=${token}`;
}

/** Claim before streaming: another GET cannot consume or expire an active archive. */
export async function claimBatchDownload(token: string | null): Promise<PreparedBatchDownload> {
  if (!token || !tokenPattern.test(token)) throw new BatchDownloadError("下载链接无效，请重新打包。", 400);
  const session = sessions.get(token);
  if (!session) throw new BatchDownloadError("下载链接已失效，请重新打包。", 404);
  sessions.delete(token);
  clearTimeout(session.timer);
  if (session.expiresAt <= Date.now()) {
    await session.archive.cleanup().catch(() => {});
    throw new BatchDownloadError("下载链接已失效，请重新打包。", 404);
  }
  return session.archive;
}
