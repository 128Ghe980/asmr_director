import type { ReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { assertBatchDownloadCapacity, claimBatchDownload, ownPreparedBatchDownload, registerBatchDownload } from "@/lib/asmr/batch-download-session";
import { BatchDownloadError, prepareBatchDownload, type PreparedBatchDownload } from "@/lib/asmr/local-batch-download";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { prepareStoryboardBatchDownload } from "@/lib/asmr/local-storyboard-batch-download";
import { AsmrProjectSchema } from "@/lib/asmr/schema";

export const runtime = "nodejs";

const processState = globalThis as typeof globalThis & { __asmrBatchDownloadActive?: boolean };

function checkCancelled(request: Request) {
  if (request.signal.aborted) throw new BatchDownloadError("已取消批量下载。", 499);
}

function errorResponse(error: unknown) {
  const known = error instanceof BatchDownloadError;
  return Response.json({ error: known ? error.message : "批量下载暂时不可用，请重试。" }, {
    status: known ? error.statusCode : 500, headers: { "cache-control": "no-store" },
  });
}

async function streamArchive(archive: PreparedBatchDownload, request: Request): Promise<Response> {
  let file: FileHandle | undefined;
  let stream: ReadStream | undefined;
  try {
    checkCancelled(request);
    const encodedName = encodeURIComponent(archive.filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const headers = new Headers({
      "content-type": "application/zip", "content-length": String(archive.size),
      "content-disposition": `attachment; filename="asmr-batch.zip"; filename*=UTF-8''${encodedName}`,
      "cache-control": "no-store", "x-asmr-clip-count": String(archive.clipCount),
    });
    // Confirm the file can be opened before returning download headers.
    file = await open(archive.filePath, "r");
    const info = await file.stat();
    if (!info.isFile() || info.size !== archive.size) throw new Error("Prepared archive unavailable");
    checkCancelled(request);
    stream = file.createReadStream();
    file = undefined; // The stream now owns and closes the file handle.
    const source = stream;
    const webStream = Readable.toWeb(source, {
      strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
    }) as ReadableStream<Uint8Array>;
    const abort = () => { source.destroy(new Error("Batch download cancelled")); };
    request.signal.addEventListener("abort", abort, { once: true });
    source.once("close", () => {
      request.signal.removeEventListener("abort", abort);
      void archive.cleanup().catch(() => {});
    });
    if (request.signal.aborted) abort();
    return new Response(webStream, { headers });
  } catch (error) {
    if (stream && !stream.closed) {
      const source = stream;
      await new Promise<void>(resolve => { source.once("close", resolve); source.destroy(); });
    }
    await file?.close().catch(() => {});
    await archive.cleanup().catch(() => {});
    if (error instanceof BatchDownloadError) throw error;
    throw new BatchDownloadError("下载包暂不可用，请重新打包。", 404);
  }
}

export async function POST(request: Request) {
  let ownsSlot = false;
  let archive: PreparedBatchDownload | undefined;
  try {
    checkCancelled(request);
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new BatchDownloadError("请提供有效的工程 JSON。", 400); }
    const kind = body && typeof body === "object" && "kind" in body ? body.kind : "audio";
    if (kind !== "audio" && kind !== "storyboard") throw new BatchDownloadError("批量下载类型无效，请选择音频或分镜。", 400);
    const rawProject = body && typeof body === "object" && "project" in body ? body.project : undefined;
    const parsed = AsmrProjectSchema.safeParse(rawProject);
    if (!parsed.success) throw new BatchDownloadError("工程格式无效，请检查工程后重试。", 400);
    if (processState.__asmrBatchDownloadActive) throw new BatchDownloadError("正在整理另一份下载包，请稍后再试。", 429);
    const wantsMetadata = request.headers.get("accept")?.split(",").some(value => value.split(";")[0].trim().toLowerCase() === "application/json") ?? false;
    if (wantsMetadata) assertBatchDownloadCapacity();
    processState.__asmrBatchDownloadActive = true;
    ownsSlot = true;
    const prepare = kind === "storyboard" ? prepareStoryboardBatchDownload : prepareBatchDownload;
    archive = ownPreparedBatchDownload(await prepare(parsed.data, getLocalRuntimeConfig(), request.signal));
    checkCancelled(request);
    if (wantsMetadata) {
      const downloadUrl = registerBatchDownload(archive);
      const response = Response.json({ downloadUrl, filename: archive.filename, clipCount: archive.clipCount, size: archive.size }, {
        headers: { "cache-control": "no-store" },
      });
      archive = undefined; // The token registry owns the prepared archive now.
      return response;
    }
    const response = await streamArchive(archive, request);
    archive = undefined; // The response stream owns cleanup now.
    return response;
  } catch (error) {
    await archive?.cleanup().catch(() => {});
    return errorResponse(error);
  } finally {
    if (ownsSlot) processState.__asmrBatchDownloadActive = false;
  }
}

export async function GET(request: Request) {
  try {
    checkCancelled(request);
    const archive = await claimBatchDownload(new URL(request.url).searchParams.get("token"));
    return await streamArchive(archive, request);
  } catch (error) {
    return errorResponse(error);
  }
}
