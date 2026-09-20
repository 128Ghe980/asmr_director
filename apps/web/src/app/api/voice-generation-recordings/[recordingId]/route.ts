import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { resolveVoiceGenerationRecording } from "@/lib/asmr/voice-generation-recordings";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ recordingId: string }> };

function parseRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return undefined;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!match[1] && Number(match[2]) <= 0)) return undefined;
  return { start, end };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { recordingId } = await context.params;
    const recording = await resolveVoiceGenerationRecording(getLocalRuntimeConfig(), recordingId);
    const headers = new Headers({ "Content-Type": "audio/wav", "Cache-Control": "no-store", "Accept-Ranges": "bytes" });
    if (new URL(request.url).searchParams.get("download") === "1") headers.set("Content-Disposition", `attachment; filename="${recording.name}"`);
    const rangeHeader = request.headers.get("range");
    const range = rangeHeader ? parseRange(rangeHeader, recording.size) : undefined;
    if (rangeHeader && !range) {
      headers.set("Content-Range", `bytes */${recording.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Length", String(range ? range.end - range.start + 1 : recording.size));
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${recording.size}`);
    const stream = createReadStream(recording.filePath, { ...range, signal: request.signal });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
  } catch (error) {
    const invalid = error instanceof Error && error.message === "Invalid recording id";
    return Response.json({ error: invalid ? "录音编号无效。" : "这条原始录音暂时无法读取，请重试。" }, { status: invalid ? 400 : 404 });
  }
}
