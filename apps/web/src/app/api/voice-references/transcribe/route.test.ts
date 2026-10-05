import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_VOICE_REFERENCE_BYTES } from "@/lib/asmr/voice-reference-import";
import { VoiceReferenceTranscriptionError } from "@/lib/asmr/voice-reference-transcription";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock("@/lib/asmr/voice-reference-transcription", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/asmr/voice-reference-transcription")>(), transcribeVoiceReference: mocks.transcribe }));
const result = { transcript: "今天辛苦了。", language: "zh", startSeconds: 0, durationSeconds: 8 };
function request(fields: Record<string, string | Blob> = { file: new Blob(["audio"]) }) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) { if (typeof value === "string") body.set(key, value); else body.set(key, value, "voice.mp3"); }
  return new Request("http://localhost/api/voice-references/transcribe", { method: "POST", body });
}
beforeEach(() => { mocks.transcribe.mockReset(); mocks.transcribe.mockResolvedValue(result); });
describe("selected reference transcription route", () => {
  it("uses default Chinese and 8 seconds and returns editable text without publication metadata", async () => {
    const input = request(), response = await POST(input);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual(result);
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({ bytes: new Uint8Array([97, 117, 100, 105, 111]), filename: "voice.mp3", language: "zh", startSeconds: 0, durationSeconds: 8, signal: input.signal }));
  });
  it("passes selected interval/language and never accepts transcript or model paths", async () => {
    await POST(request({ file: new Blob(["audio"]), startSeconds: "10.5", durationSeconds: "4", language: "ja" }));
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({ startSeconds: 10.5, durationSeconds: 4, language: "ja" }));
  });
  it.each([
    {}, { file: "private-path.wav" }, { file: new Blob() }, { file: new Blob(["audio"]), modelPath: "private" },
    { file: new Blob(["audio"]), promptText: "invented text" }, { file: new Blob(["audio"]), name: "声音" },
    { file: new Blob(["audio"]), startSeconds: "NaN" }, { file: new Blob(["audio"]), durationSeconds: " " },
    { file: new Blob(["audio"]), language: new Blob(["zh"]) },
  ] as Record<string, string | Blob>[])("rejects malformed multipart fields", async fields => {
    expect((await POST(request(fields))).status).toBe(400); expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("rejects duplicate or non-multipart fields", async () => {
    const body = new FormData(); body.set("file", new Blob(["audio"]), "voice.wav"); body.append("language", "zh"); body.append("language", "en");
    expect((await POST(new Request("http://localhost", { method: "POST", body }))).status).toBe(400);
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status).toBe(415);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("rejects oversized content length before reading the body", async () => {
    const input = request(); input.headers.set("content-length", String(MAX_VOICE_REFERENCE_BYTES + 65537));
    expect((await POST(input)).status).toBe(413); expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("bounds undeclared body size", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('--x\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n'));
      controller.enqueue(new Uint8Array(MAX_VOICE_REFERENCE_BYTES + 65537)); controller.close();
    } });
    const input = new Request("http://localhost", { method: "POST", body: stream, headers: { "content-type": "multipart/form-data; boundary=x" }, duplex: "half" } as RequestInit & { duplex: "half" });
    expect((await POST(input)).status).toBe(413); expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("preserves explicit recognition failures and hides internal errors", async () => {
    mocks.transcribe.mockRejectedValueOnce(new VoiceReferenceTranscriptionError("没有识别到清晰台词。", 422));
    const known = await POST(request()); expect(known.status).toBe(422); expect(await known.json()).toEqual({ error: "没有识别到清晰台词。" });
    mocks.transcribe.mockRejectedValueOnce(new Error("private-model-path"));
    const failed = await POST(request()); expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain("private");
  });
  it("rejects pre-cancelled requests without recognition", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await POST(new Request(request(), { signal: controller.signal }))).status).toBe(499); expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});
