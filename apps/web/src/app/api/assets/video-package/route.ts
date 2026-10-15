import { assertBatchDownloadCapacity, ownPreparedBatchDownload, registerBatchDownload } from "@/lib/asmr/batch-download-session";
import { BatchDownloadError, type PreparedBatchDownload } from "@/lib/asmr/local-batch-download";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { getVideoPackageReferenceExtension, MAX_VIDEO_REFERENCE_BYTES, prepareVideoPackage } from "@/lib/asmr/local-video-package";
import { AsmrProjectSchema } from "@/lib/asmr/schema";

export const runtime = "nodejs";
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_PROJECT_BYTES + MAX_VIDEO_REFERENCE_BYTES + 65536;
const processState = globalThis as typeof globalThis & { __asmrVideoPackageActive?: boolean };

function checkCancelled(request: Request) {
  if (request.signal.aborted) throw new BatchDownloadError("已取消视频项目包导出。", 499);
}

async function readForm(request: Request): Promise<FormData> {
  const url = new URL(request.url), origin = request.headers.get("origin");
  if (origin && origin !== `${url.protocol}//${request.headers.get("host") || url.host}`) {
    throw new BatchDownloadError("请从当前工作台导出视频项目包。", 403);
  }
  const contentType = request.headers.get("content-type");
  if (contentType?.split(";", 1)[0].trim().toLowerCase() !== "multipart/form-data") throw new BatchDownloadError("请使用工程与参考图文件表单提交。", 415);
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) {
    void request.body?.cancel().catch(() => {});
    throw new BatchDownloadError("视频项目包请求过大，请缩小工程或参考图后重试。", 413);
  }
  checkCancelled(request);
  const reader = request.body?.getReader();
  if (!reader) throw new BatchDownloadError("请提供完整的工程文件表单。", 400);
  let rejectRead: ((error: Error) => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectRead = reject; });
  void interrupted.catch(() => {});
  const interrupt = (error: Error) => {
    rejectRead?.(error);
    void reader.cancel().catch(() => {});
  };
  const cancel = () => interrupt(new BatchDownloadError("已取消视频项目包导出。", 499));
  request.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => interrupt(new BatchDownloadError("工程表单接收超时，请重试。", 408)), 10_000);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (request.signal.aborted) cancel();
    while (true) {
      checkCancelled(request);
      const result = await Promise.race([reader.read(), interrupted]);
      checkCancelled(request);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new BatchDownloadError("视频项目包请求过大，请缩小工程或参考图后重试。", 413);
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const result = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    checkCancelled(request);
    return result;
  } catch (error) {
    checkCancelled(request);
    if (error instanceof BatchDownloadError) throw error;
    throw new BatchDownloadError("无法读取工程文件表单，请重试。", 400);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel); reader.releaseLock();
  }
}

export async function POST(request: Request) {
  let ownsSlot = false;
  let archive: PreparedBatchDownload | undefined;
  try {
    checkCancelled(request);
    const form = await readForm(request);
    const allowed = new Set(["project", "reference"]);
    for (const key of form.keys()) if (!allowed.has(key) || form.getAll(key).length !== 1) throw new BatchDownloadError("工程文件表单参数无效。", 400);
    const rawProject = form.get("project");
    if (typeof rawProject !== "string") throw new BatchDownloadError("请提供完整的工程 JSON。", 400);
    if (new TextEncoder().encode(rawProject).byteLength > MAX_PROJECT_BYTES) throw new BatchDownloadError("工程 JSON 过大（上限 2 MiB）。", 413);
    let parsed;
    try { parsed = AsmrProjectSchema.safeParse(JSON.parse(rawProject)); }
    catch { throw new BatchDownloadError("工程 JSON 无效，请检查工程后重试。", 400); }
    if (!parsed.success) throw new BatchDownloadError("工程格式无效，请检查工程后重试。", 400);
    const referenceFile = form.get("reference");
    let reference: Uint8Array | undefined;
    if (referenceFile !== null) {
      if (!(referenceFile instanceof Blob) || !referenceFile.size || !("name" in referenceFile)) throw new BatchDownloadError("请上传非空的角色参考图文件。", 400);
      if (referenceFile.size > MAX_VIDEO_REFERENCE_BYTES) throw new BatchDownloadError("角色参考图过大（上限 8 MiB）。", 413);
      reference = new Uint8Array(await referenceFile.arrayBuffer());
      getVideoPackageReferenceExtension(reference);
    }
    checkCancelled(request);
    if (processState.__asmrVideoPackageActive) throw new BatchDownloadError("正在整理另一份视频项目包，请稍后再试。", 429);
    assertBatchDownloadCapacity();
    processState.__asmrVideoPackageActive = true; ownsSlot = true;
    archive = ownPreparedBatchDownload(await prepareVideoPackage(parsed.data, getLocalRuntimeConfig(), request.signal, reference ? { reference } : {}));
    checkCancelled(request);
    const downloadUrl = registerBatchDownload(archive);
    const response = Response.json({ downloadUrl, filename: archive.filename, clipCount: archive.clipCount, size: archive.size }, { headers: { "cache-control": "no-store" } });
    archive = undefined; // The existing single-use download session owns streaming and cleanup.
    return response;
  } catch (error) {
    await archive?.cleanup().catch(() => {});
    const known = error instanceof BatchDownloadError;
    return Response.json({ error: request.signal.aborted ? "已取消视频项目包导出。" : known ? error.message : "视频项目包暂时无法导出，请重试。" }, {
      status: request.signal.aborted ? 499 : known ? error.statusCode : 500, headers: { "cache-control": "no-store" },
    });
  } finally { if (ownsSlot) processState.__asmrVideoPackageActive = false; }
}
