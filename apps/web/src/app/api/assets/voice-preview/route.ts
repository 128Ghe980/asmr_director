import type { ReadStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { VoicePreviewError, prepareVoicePreview, type PreparedVoicePreview } from "@/lib/asmr/local-voice-preview";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { AsmrProjectSchema } from "@/lib/asmr/schema";
import { acquireVoicePreview, assertVoicePreviewCapacity, registerVoicePreview, removeVoicePreview } from "@/lib/asmr/voice-preview-session";

export const runtime = "nodejs";
const state = globalThis as typeof globalThis & { __asmrVoicePreviewPreparing?: boolean };
function check(request: Request) { if (request.signal.aborted) throw new VoicePreviewError("已取消整体预览。", 499); }
function errorResponse(error: unknown) {
  const known = error instanceof VoicePreviewError;
  return Response.json({ error: known ? error.message : "语音预览暂不可用，请重试。" }, {
    status: known ? error.statusCode : 500, headers: { "cache-control": "no-store" },
  });
}
export async function POST(request: Request) {
  let ownsSlot = false, prepared: PreparedVoicePreview | undefined, registeredUrl: string | undefined;
  try {
    check(request);
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new VoicePreviewError("请提供有效的工程 JSON。", 400); }
    const project = AsmrProjectSchema.safeParse(body && typeof body === "object" && "project" in body ? body.project : undefined);
    if (!project.success) throw new VoicePreviewError("工程格式无效，请检查后重试。", 400);
    if (state.__asmrVoicePreviewPreparing) throw new VoicePreviewError("正在整理另一份语音预览，请稍后重试。", 429);
    assertVoicePreviewCapacity(); state.__asmrVoicePreviewPreparing = true; ownsSlot = true;
    prepared = await prepareVoicePreview(project.data, getLocalRuntimeConfig(), request.signal);
    check(request);
    const metadata = registerVoicePreview(prepared);
    registeredUrl = metadata.audioUrl; prepared = undefined;
    check(request);
    return Response.json(metadata, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    await prepared?.cleanup().catch(() => {});
    if (registeredUrl) await removeVoicePreview(new URL(registeredUrl, request.url).searchParams.get("token")).catch(() => {});
    return errorResponse(error);
  } finally { if (ownsSlot) state.__asmrVoicePreviewPreparing = false; }
}

function parseRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) throw new VoicePreviewError("音频读取范围无效。", 416);
  const first = match[1] ? Number(match[1]) : undefined, last = match[2] ? Number(match[2]) : undefined;
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last)))
    throw new VoicePreviewError("音频读取范围无效。", 416);
  const start = first ?? Math.max(0, size - last!), end = first === undefined || last === undefined ? size - 1 : Math.min(last, size - 1);
  if ((first === undefined && last === 0) || start >= size || end < start) throw new VoicePreviewError("音频读取范围无效。", 416);
  return { start, end };
}
async function serve(request: Request, head = false): Promise<Response> {
  let lease: Awaited<ReturnType<typeof acquireVoicePreview>> | undefined, file: FileHandle | undefined, stream: ReadStream | undefined;
  try {
    check(request);
    const url = new URL(request.url);
    lease = await acquireVoicePreview(url.searchParams.get("token"));
    const { preview } = lease;
    let range: ReturnType<typeof parseRange>;
    try { range = parseRange(request.headers.get("range"), preview.size); }
    catch (error) { const response = errorResponse(error); response.headers.set("content-range", `bytes */${preview.size}`); await lease.release(); lease = undefined; return response; }
    const encoded = encodeURIComponent(preview.filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const headers = new Headers({ "content-type": "audio/wav", "cache-control": "no-store", "accept-ranges": "bytes",
      "content-length": String(range ? range.end - range.start + 1 : preview.size),
      "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="asmr-voice-preview.wav"; filename*=UTF-8''${encoded}` });
    if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${preview.size}`);
    file = await open(preview.filePath, "r");
    const info = await file.stat();
    if (!info.isFile() || info.size !== preview.size) throw new VoicePreviewError("预览文件不可用，请重新生成预览。", 404);
    check(request);
    if (head) { await file.close(); file = undefined; await lease.release(); lease = undefined; return new Response(null, { status: range ? 206 : 200, headers }); }
    stream = file.createReadStream(range ?? {}); file = undefined;
    const source = stream, activeLease = lease; lease = undefined;
    const abort = () => { source.destroy(new Error("Voice preview request cancelled")); };
    request.signal.addEventListener("abort", abort, { once: true });
    source.once("close", () => { request.signal.removeEventListener("abort", abort); void activeLease.release().catch(() => {}); });
    const webStream = Readable.toWeb(source, { strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength } }) as ReadableStream<Uint8Array>;
    if (request.signal.aborted) abort();
    return new Response(webStream, { status: range ? 206 : 200, headers });
  } catch (error) {
    if (stream && !stream.closed) await new Promise<void>(resolve => { stream!.once("close", resolve); stream!.destroy(); });
    await file?.close().catch(() => {}); await lease?.release().catch(() => {});
    if (!(error instanceof VoicePreviewError)) error = new VoicePreviewError("预览文件不可用，请重新生成预览。", 404);
    return errorResponse(error);
  }
}
export async function GET(request: Request) { return serve(request); }
export async function HEAD(request: Request) { return serve(request, true); }
export async function DELETE(request: Request) {
  try { await removeVoicePreview(new URL(request.url).searchParams.get("token")); return new Response(null, { status: 204, headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
