import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderSpatialClip, SpatialAudioError } from "@/lib/asmr/spatial-audio";
import { GET } from "./route";

vi.mock("@/lib/asmr/spatial-audio", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/asmr/spatial-audio")>(), renderSpatialClip: vi.fn() }));
const render = vi.mocked(renderSpatialClip);
const position = { pan: -.5, distance: "near", movement: "static" };
const url = (extra = "") => `http://localhost/api/assets/spatial/voice?position=${encodeURIComponent(JSON.stringify(position))}${extra}`;
const context = { params: Promise.resolve({ assetId: "voice" }) };
beforeEach(() => { render.mockReset(); render.mockResolvedValue({ wav: Uint8Array.from([1, 2, 3, 4, 5, 6]), spatialized: true }); });

describe("GET /api/assets/spatial/[assetId]", () => {
  it("passes only validated render controls and the cancellation signal", async () => {
    const request = new Request(url("&duration=45&fadeIn=.1&fadeOut=.2"));
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("x-asmr-spatialized")).toBe("true");
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ assetId: "voice", position, durationSeconds: 45, fadeInSeconds: .1, fadeOutSeconds: .2, signal: request.signal }));
  });
  it("supports byte, open and suffix ranges for seeking", async () => {
    for (const [range, expected, contentRange] of [["bytes=1-3", [2, 3, 4], "bytes 1-3/6"], ["bytes=4-", [5, 6], "bytes 4-5/6"], ["bytes=-2", [5, 6], "bytes 4-5/6"]] as const) {
      const response = await GET(new Request(url(), { headers: { range } }), context);
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(contentRange);
      expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(expected);
    }
    const invalid = await GET(new Request(url(), { headers: { range: "bytes=99-" } }), context);
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */6");
    const stale = await GET(new Request(url(), { headers: { range: "bytes=1-3", "if-range": '"old"' } }), context);
    expect(stale.status).toBe(200);
  });
  it("rejects unsafe ids, missing/unknown/duplicate/invalid parameters before rendering", async () => {
    const invalidUrls = ["http://localhost/api/assets/spatial/voice", url("&inputWav=secret"), url("&duration=NaN"), url("&duration=601"), url("&duration=3&duration=4"), url("&fadeIn=-1"), "http://localhost/api/assets/spatial/voice?position=%7B%7D"];
    for (const invalidUrl of invalidUrls) expect((await GET(new Request(invalidUrl), context)).status).toBe(400);
    expect((await GET(new Request(url()), { params: Promise.resolve({ assetId: "../secret" }) })).status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });
  it("returns structured missing-runtime and cancellation errors", async () => {
    render.mockRejectedValueOnce(new SpatialAudioError("Python 不可用。", 503));
    const missing = await GET(new Request(url()), context);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "Python 不可用。" });
    render.mockRejectedValueOnce(new SpatialAudioError("已取消空间处理。", 499));
    expect((await GET(new Request(url()), context)).status).toBe(499);
  });
});
