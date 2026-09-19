import { createHash } from "node:crypto";
import { getLocalRuntimeConfig } from "@/lib/asmr/local-runtime-config";
import { PositionSchema } from "@/lib/asmr/schema";
import { MAX_SPATIAL_DURATION_SECONDS, renderSpatialClip, SpatialAudioError } from "@/lib/asmr/spatial-audio";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ assetId: string }> };

function parseParameters(url: URL) {
  const allowed = new Set(["position", "duration", "fadeIn", "fadeOut"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new SpatialAudioError("空间试听参数无效。", 400);
  }
  const rawPosition = url.searchParams.get("position");
  if (!rawPosition || rawPosition.length > 2048) throw new SpatialAudioError("请提供有效的声音位置。", 400);
  let position;
  try { position = PositionSchema.strict().parse(JSON.parse(rawPosition)); }
  catch { throw new SpatialAudioError("声音位置参数无效。", 400); }
  const number = (key: string, positive: boolean) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return undefined;
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < 0 || (positive && value < 1 / 48000) || value > MAX_SPATIAL_DURATION_SECONDS) throw new SpatialAudioError("空间试听时长参数无效（最长 10 分钟）。", 400);
    return value;
  };
  return { position, durationSeconds: number("duration", true), fadeInSeconds: number("fadeIn", false), fadeOutSeconds: number("fadeOut", false) };
}

function getRange(value: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return undefined;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]), requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return undefined;
  return { start, end: Math.min(size - 1, requestedEnd) };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { assetId } = await context.params;
    if (!/^[A-Za-z0-9_-]+$/.test(assetId)) throw new SpatialAudioError("音频素材编号无效。", 400);
    const parameters = parseParameters(new URL(request.url));
    const result = await renderSpatialClip({ assetId, ...parameters, config: getLocalRuntimeConfig(), signal: request.signal });
    const etag = `"${createHash("sha256").update(result.wav).digest("hex")}"`;
    const headers = new Headers({ "content-type": "audio/wav", "accept-ranges": "bytes", "cache-control": "no-store", "etag": etag, "x-asmr-spatialized": String(result.spatialized) });
    const rangeHeader = request.headers.get("range"), ifRange = request.headers.get("if-range");
    if (rangeHeader && (!ifRange || ifRange === etag)) {
      const range = getRange(rangeHeader, result.wav.byteLength);
      if (!range) {
        headers.set("content-range", `bytes */${result.wav.byteLength}`);
        headers.set("content-type", "application/json");
        return Response.json({ error: "音频读取范围无效。" }, { status: 416, headers });
      }
      headers.set("content-range", `bytes ${range.start}-${range.end}/${result.wav.byteLength}`);
      headers.set("content-length", String(range.end - range.start + 1));
      return new Response(Buffer.from(result.wav.subarray(range.start, range.end + 1)), { status: 206, headers });
    }
    headers.set("content-length", String(result.wav.byteLength));
    return new Response(Buffer.from(result.wav), { headers });
  } catch (error) {
    const known = error instanceof SpatialAudioError;
    return Response.json({ error: known ? error.message : "空间试听暂时不可用，请重试。" }, { status: known ? error.statusCode : 500 });
  }
}
