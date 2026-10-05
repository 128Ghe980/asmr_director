import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_VOICE_REFERENCE_BYTES, VoiceReferenceImportError } from "@/lib/asmr/voice-reference-import";
import { POST } from "./route";
import { GET } from "./[referenceId]/audio/route";

const mocks = vi.hoisted(() => ({ importReference: vi.fn(), readAudio: vi.fn(), catalog: vi.fn() }));
vi.mock("@/lib/asmr/voice-reference-import", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/asmr/voice-reference-import")>(), importVoiceReference: mocks.importReference, readVoiceReferenceAudio: mocks.readAudio }));
vi.mock("@/lib/asmr/voice-provider-catalog", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/asmr/voice-provider-catalog")>(), getVoiceProviderCatalog: mocks.catalog }));

function request(fields: Record<string, string | Blob> = { file: new Blob(["audio"]), name: "正太音" }) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) { if (typeof value === "string") body.set(key, value); else body.set(key, value, "reference.mp3"); }
  return new Request("http://localhost/api/voice-references", { method: "POST", body });
}
const reference = { id: "user-test", label: "正太音", referenceModes: ["reference_only"], audioUrl: "/api/voice-references/user-test/audio", durationSeconds: 15 };
beforeEach(() => {
  mocks.importReference.mockReset(); mocks.readAudio.mockReset(); mocks.catalog.mockReset();
  mocks.importReference.mockResolvedValue(reference); mocks.catalog.mockResolvedValue({ providers: [] }); mocks.readAudio.mockResolvedValue(new Uint8Array([82, 73, 70, 70]));
});

describe("voice reference routes", () => {
  it("imports a bounded multipart file with defaults, keeps private fields server-side and returns updated catalog", async () => {
    const input = request(), response = await POST(input);
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ reference, catalog: { providers: [] } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.importReference).toHaveBeenCalledWith(expect.objectContaining({ bytes: new Uint8Array([97, 117, 100, 105, 111]), filename: "reference.mp3", name: "正太音", startSeconds: 0, durationSeconds: 15, signal: input.signal }));
    expect(mocks.importReference.mock.calls[0][0]).not.toHaveProperty("promptText");
  });
  it("passes selected interval and actual optional transcript to the importer", async () => {
    await POST(request({ file: new Blob(["audio"]), name: "声音", startSeconds: "12.5", durationSeconds: "8", promptText: "实际台词" }));
    expect(mocks.importReference).toHaveBeenCalledWith(expect.objectContaining({ startSeconds: 12.5, durationSeconds: 8, promptText: "实际台词" }));
  });
  it.each([
    { name: "missing file" }, { file: "arbitrary-path.wav", name: "声音" }, { file: new Blob(), name: "声音" },
    { file: new Blob(["audio"]), name: "声音", audioPath: "C:/private.wav" },
    { file: new Blob(["audio"]), name: "声音", startSeconds: "NaN" },
    { file: new Blob(["audio"]), name: "声音", durationSeconds: " " },
    { file: new Blob(["audio"]), name: new Blob(["name"]) },
  ] as Record<string, string | Blob>[])("rejects malformed fields without invoking the importer", async fields => {
    const response = await POST(request(fields)); expect(response.status).toBe(400); expect(mocks.importReference).not.toHaveBeenCalled();
  });
  it("rejects duplicate fields and non-multipart requests", async () => {
    const body = new FormData(); body.set("file", new Blob(["audio"]), "voice.wav"); body.append("name", "甲"); body.append("name", "乙");
    expect((await POST(new Request("http://localhost", { method: "POST", body }))).status).toBe(400);
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status).toBe(415);
    expect(mocks.importReference).not.toHaveBeenCalled();
  });
  it("rejects a declared oversized request before parsing the body", async () => {
    const input = request(); input.headers.set("content-length", String(MAX_VOICE_REFERENCE_BYTES + 65537));
    expect((await POST(input)).status).toBe(413); expect(mocks.importReference).not.toHaveBeenCalled();
  });
  it("bounds a multipart body even when no content length is supplied", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode('--x\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n'));
      controller.enqueue(new Uint8Array(MAX_VOICE_REFERENCE_BYTES + 65537)); controller.close();
    } });
    const input = new Request("http://localhost", { method: "POST", body: stream, headers: { "content-type": "multipart/form-data; boundary=x" }, duplex: "half" } as RequestInit & { duplex: "half" });
    expect((await POST(input)).status).toBe(413); expect(mocks.importReference).not.toHaveBeenCalled();
  });
  it("returns safe actionable native/storage errors and keeps unexpected filesystem details private", async () => {
    mocks.importReference.mockRejectedValueOnce(new VoiceReferenceImportError("音频不足所选片段长度。", 422));
    const rejected = await POST(request()); expect(rejected.status).toBe(422); expect(await rejected.json()).toEqual({ error: "音频不足所选片段长度。" });
    mocks.importReference.mockRejectedValueOnce(new Error("C:/private-path/source.wav ENOSPC"));
    const failed = await POST(request()); expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain("private-path");
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("rejects cancelled requests before reading/uploading", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await POST(new Request(request(), { signal: controller.signal }))).status).toBe(499);
    expect(mocks.importReference).not.toHaveBeenCalled();
  });
  it("serves a reference by opaque ID as WAV without exposing its disk path", async () => {
    const input = new Request("http://localhost/api/voice-references/old/audio");
    const response = await GET(input, { params: Promise.resolve({ referenceId: "old" }) });
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("audio/wav"); expect(response.headers.get("content-disposition")).toBe('inline; filename="reference.wav"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
    expect(mocks.readAudio).toHaveBeenCalledWith("old", expect.any(Object), input.signal);
    mocks.readAudio.mockRejectedValue(new Error("C:/private-reference.wav"));
    const failure = await GET(input, { params: Promise.resolve({ referenceId: "old" }) }); expect(failure.status).toBe(500); expect(JSON.stringify(await failure.json())).not.toContain("private-reference");
  });
});
