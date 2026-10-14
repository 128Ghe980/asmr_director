import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreparedVoicePreview } from "./local-voice-preview";
import { acquireVoicePreview, assertVoicePreviewCapacity, registerVoicePreview, removeVoicePreview, VOICE_PREVIEW_TTL_MS } from "./voice-preview-session";

const tokens = new Set<string>();
const tokenFromUrl = (url: string) => new URL(url, "http://localhost").searchParams.get("token")!;
function prepare() {
  const cleanup = vi.fn(async () => {});
  const preview: PreparedVoicePreview = { filePath: "unused-private.wav", filename: "预览.wav", clipCount: 1, skippedCount: 0, duration: 1, size: 44, cleanup };
  const result = registerVoicePreview(preview), token = tokenFromUrl(result.audioUrl); tokens.add(token);
  return { token, cleanup };
}
afterEach(async () => { vi.useRealTimers(); for (const token of tokens) await removeVoicePreview(token); tokens.clear(); });
describe("voice preview media lifecycle", () => {
  it("defers deletion until every concurrent media lease closes, then releases once", async () => {
    const { token, cleanup } = prepare(), first = await acquireVoicePreview(token), second = await acquireVoicePreview(token);
    await removeVoicePreview(token); expect(cleanup).not.toHaveBeenCalled();
    await expect(acquireVoicePreview(token)).rejects.toMatchObject({ statusCode: 404 });
    await first.release(); expect(cleanup).not.toHaveBeenCalled();
    await Promise.all([second.release(), second.release(), first.release()]); expect(cleanup).toHaveBeenCalledOnce();
  });
  it("retires expired tokens immediately while retaining a live media stream", async () => {
    vi.useFakeTimers(); const { token, cleanup } = prepare(), lease = await acquireVoicePreview(token);
    await vi.advanceTimersByTimeAsync(VOICE_PREVIEW_TTL_MS); expect(cleanup).not.toHaveBeenCalled();
    await expect(acquireVoicePreview(token)).rejects.toMatchObject({ statusCode: 404 });
    await lease.release(); expect(cleanup).toHaveBeenCalledOnce();
  });
  it("counts retired active streams against capacity until handles finish", async () => {
    const { token } = prepare(); const lease = await acquireVoicePreview(token); await removeVoicePreview(token);
    prepare(); prepare(); expect(() => assertVoicePreviewCapacity()).toThrow();
    await lease.release(); expect(() => assertVoicePreviewCapacity()).not.toThrow();
  });
});
