import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prepareVoicePreview, VoicePreviewError, type PreparedVoicePreview } from "@/lib/asmr/local-voice-preview";
import { demoProject } from "@/lib/asmr/mock-project";
import { VOICE_PREVIEW_TTL_MS } from "@/lib/asmr/voice-preview-session";
import { DELETE, GET, HEAD, POST } from "./route";

vi.mock("@/lib/asmr/local-voice-preview", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/asmr/local-voice-preview")>(), prepareVoicePreview: vi.fn() }));
const prepare = vi.mocked(prepareVoicePreview), bytes = Uint8Array.from([82, 73, 70, 70, 5, 6, 7, 8]);
let root: string, preview: PreparedVoicePreview, cleanup: Mock<() => Promise<void>>;
const urls = new Set<string>();
beforeEach(async () => {
  const base = process.platform === "win32" ? "I:/AI" : tmpdir(); await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-preview-route-")); const filePath = path.join(root, "preview.wav"); await writeFile(filePath, bytes);
  cleanup = vi.fn(async () => {}); preview = { filePath, filename: "生日_已采用语音预览.wav", clipCount: 2, skippedCount: 3, duration: 12.5, size: bytes.length, cleanup };
  prepare.mockReset(); prepare.mockResolvedValue(preview);
});
afterEach(async () => {
  vi.useRealTimers();
  for (const url of urls) await DELETE(new Request(new URL(url, "http://localhost"), { method: "DELETE" }));
  urls.clear(); await rm(root, { recursive: true, force: true });
});
const request = (signal?: AbortSignal) => new Request("http://localhost/api/assets/voice-preview", { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ project: demoProject }), signal });
async function metadata() {
  const response = await POST(request()); expect(response.status).toBe(200);
  const result = await response.json() as { audioUrl: string; filename: string; clipCount: number; skippedCount: number; duration: number; size: number; expiresAt: number };
  urls.add(result.audioUrl); return result;
}
const media = (url: string, range?: string, signal?: AbortSignal) => GET(new Request(new URL(url, "http://localhost"), { headers: range ? { range } : undefined, signal }));
describe("reusable native voice preview media", () => {
  it("prepares small private JSON, plays repeatedly and downloads the exact same WAV", async () => {
    const result = await metadata();
    expect(result).toEqual({ audioUrl: expect.stringMatching(/^\/api\/assets\/voice-preview\?token=[0-9a-f-]{36}$/), filename: preview.filename,
      clipCount: 2, skippedCount: 3, duration: 12.5, size: 8, expiresAt: expect.any(Number) });
    expect(JSON.stringify(result)).not.toContain(root); expect(cleanup).not.toHaveBeenCalled();
    for (const url of [result.audioUrl, result.audioUrl, `${result.audioUrl}&download=1`]) {
      const response = await media(url); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("audio/wav");
      expect(response.headers.get("accept-ranges")).toBe("bytes"); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-length")).toBe("8");
      expect(response.headers.get("content-disposition")).toContain(url.includes("download=1") ? "attachment;" : "inline;");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    }
    expect(prepare).toHaveBeenCalledOnce(); expect(cleanup).not.toHaveBeenCalled();
  });
  it("supports bounded, open and suffix ranges without consuming the token", async () => {
    const { audioUrl } = await metadata();
    for (const [range, start, end] of [["bytes=1-3", 1, 3], ["bytes=5-", 5, 7], ["bytes=-3", 5, 7], ["bytes=0-999", 0, 7]] as const) {
      const response = await media(audioUrl, range); expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/8`);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(start, end + 1));
    }
    expect(cleanup).not.toHaveBeenCalled();
  });
  it("returns 416 for invalid ranges and leaves later full playback available", async () => {
    const { audioUrl } = await metadata();
    for (const range of ["bytes=8-", "bytes=5-2", "bytes=-0", "bytes=0-1,3-4", "bytes=", "bytes=999999999999999999999-"]) {
      const response = await media(audioUrl, range); expect(response.status).toBe(416); expect(response.headers.get("content-range")).toBe("bytes */8");
    }
    expect(new Uint8Array(await (await media(audioUrl)).arrayBuffer())).toEqual(bytes);
  });
  it("HEAD validates the file without opening a response stream or consuming media", async () => {
    const { audioUrl } = await metadata(), response = await HEAD(new Request(new URL(audioUrl, "http://localhost")));
    expect(response.status).toBe(200); expect(response.headers.get("content-length")).toBe("8"); expect(await response.text()).toBe("");
    expect(new Uint8Array(await (await media(audioUrl)).arrayBuffer())).toEqual(bytes);
  });
  it("DELETE is idempotent and prevents new requests while an existing stream completes safely", async () => {
    const { audioUrl } = await metadata(), response = await media(audioUrl);
    expect((await DELETE(new Request(new URL(audioUrl, "http://localhost"), { method: "DELETE" }))).status).toBe(204);
    expect(cleanup).not.toHaveBeenCalled(); expect((await media(audioUrl)).status).toBe(404);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect((await DELETE(new Request(new URL(audioUrl, "http://localhost"), { method: "DELETE" }))).status).toBe(204);
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it("expires an abandoned preview and cleans it exactly once", async () => {
    vi.useFakeTimers(); const { audioUrl } = await metadata();
    await vi.advanceTimersByTimeAsync(VOICE_PREVIEW_TTL_MS); expect(cleanup).toHaveBeenCalledOnce();
    expect((await media(audioUrl)).status).toBe(404);
    await DELETE(new Request(new URL(audioUrl, "http://localhost"), { method: "DELETE" })); expect(cleanup).toHaveBeenCalledOnce();
  });
  it("enforces preview capacity and releases a slot when a preview is removed", async () => {
    const first = await metadata(); await metadata(); await metadata();
    expect((await POST(request())).status).toBe(429); expect(prepare).toHaveBeenCalledTimes(3);
    await DELETE(new Request(new URL(first.audioUrl, "http://localhost"), { method: "DELETE" }));
    expect((await metadata()).clipCount).toBe(2);
  });
  it("serializes preparation and releases the slot after a failure", async () => {
    let resolve!: (value: PreparedVoicePreview) => void;
    prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = POST(request()); await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect((await POST(request())).status).toBe(429);
    resolve(preview); const response = await first, result = await response.json(); urls.add(result.audioUrl);
    prepare.mockRejectedValueOnce(new VoicePreviewError("坏文件", 422)); expect((await POST(request())).status).toBe(422);
    expect((await metadata()).clipCount).toBe(2);
  });
  it("rejects malformed project, private paths and unknown tokens without disclosing filesystem paths", async () => {
    expect((await POST(new Request("http://localhost/api/assets/voice-preview", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/assets/voice-preview", { method: "POST", body: "{}" }))).status).toBe(400);
    for (const token of ["../../preview.wav", root, "00000000-0000-0000-0000-000000000000"]) {
      const response = await media(`/api/assets/voice-preview?token=${encodeURIComponent(token)}`);
      expect(response.status).toBe(token.startsWith("000000") ? 404 : 400); expect(JSON.stringify(await response.json())).not.toContain(root);
    }
    expect(prepare).not.toHaveBeenCalled();
  });
  it("cleans a completed preparation when cancellation arrives before publication", async () => {
    const controller = new AbortController(); prepare.mockImplementationOnce(async () => { controller.abort(); return preview; });
    expect((await POST(request(controller.signal))).status).toBe(499); expect(cleanup).toHaveBeenCalledOnce();
  });
  it("rejects missing or altered prepared files and releases media leases", async () => {
    const { audioUrl } = await metadata(); await writeFile(preview.filePath, bytes.slice(0, 3));
    expect((await media(audioUrl)).status).toBe(404); await rm(preview.filePath); expect((await media(audioUrl)).status).toBe(404);
    await DELETE(new Request(new URL(audioUrl, "http://localhost"), { method: "DELETE" })); expect(cleanup).toHaveBeenCalledOnce();
  });
});
