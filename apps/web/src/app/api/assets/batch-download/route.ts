import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { BatchDownloadError, prepareBatchDownload } from "@/lib/asmr/local-batch-download";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { AsmrProjectSchema } from "@/lib/asmr/schema";

export const runtime = "nodejs";

const processState = globalThis as typeof globalThis & { __asmrBatchDownloadActive?: boolean };

export async function POST(request: Request) {
  let ownsSlot = false;
  try {
    if (request.signal.aborted) throw new BatchDownloadError("已取消批量下载。", 499);
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new BatchDownloadError("请提供有效的工程 JSON。", 400); }
    const rawProject = body && typeof body === "object" && "project" in body ? body.project : undefined;
    const parsed = AsmrProjectSchema.safeParse(rawProject);
    if (!parsed.success) throw new BatchDownloadError("工程格式无效，请检查工程后重试。", 400);
    if (processState.__asmrBatchDownloadActive) throw new BatchDownloadError("正在整理另一份音频包，请稍后再试。", 429);
    processState.__asmrBatchDownloadActive = true;
    ownsSlot = true;
    const archive = await prepareBatchDownload(parsed.data, getLocalRuntimeConfig(), request.signal);
    if (request.signal.aborted) {
      await archive.cleanup();
      throw new BatchDownloadError("已取消批量下载。", 499);
    }
    const stream = createReadStream(archive.filePath);
    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    const abort = () => { stream.destroy(new Error("Batch download cancelled")); };
    request.signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () => {
      request.signal.removeEventListener("abort", abort);
      void archive.cleanup().catch(() => {});
    });
    if (request.signal.aborted) abort();
    const encodedName = encodeURIComponent(archive.filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(webStream, {
      headers: {
        "content-type": "application/zip", "content-length": String(archive.size),
        "content-disposition": `attachment; filename="asmr-audio.zip"; filename*=UTF-8''${encodedName}`,
        "cache-control": "no-store", "x-asmr-clip-count": String(archive.clipCount),
      },
    });
  } catch (error) {
    const known = error instanceof BatchDownloadError;
    return Response.json({ error: known ? error.message : "批量下载暂时不可用，请重试。" }, { status: known ? error.statusCode : 500 });
  } finally {
    if (ownsSlot) processState.__asmrBatchDownloadActive = false;
  }
}
