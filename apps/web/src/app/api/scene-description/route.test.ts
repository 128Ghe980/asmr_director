import { afterEach, describe, expect, it, vi } from "vitest";

import { createStoryboardSourceFingerprint } from "../../../lib/asmr/storyboard";
import { POST } from "./route";

const draft = {
  title: "厨房", scene: "暖光厨房", character: { role: "主人", personality: ["体贴"], speechStyle: ["轻声"] },
  sections: [{ id: "one", title: "迎接", text: "回来啦。", emotion: "温柔", style: "轻声", pace: "slow", direction: "", soundSuggestions: "", pauseAfter: "medium" as const, position: { pan: 0, distance: "near" as const, movement: "static" as const } }],
};
const input = { provider: "ollama", draft };
function request(body: unknown) { return new Request("http://localhost/api/scene-description", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("/api/scene-description", () => {
  it("returns scene text and server provenance without changing the draft", async () => {
    const sceneDescription = "A quiet, warmly lit home kitchen with wooden cabinets.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: { content: JSON.stringify({ sceneDescription }) } })));
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ sceneDescription, sourceFingerprint: createStoryboardSourceFingerprint(draft), provider: "ollama" });
  });

  it("rejects malformed JSON, empty drafts, unknown providers and browser-supplied infrastructure", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const malformed = new Request("http://localhost/api/scene-description", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    for (const body of [{ ...input, draft: { ...draft, sections: [] } }, { ...input, provider: "other" }, { ...input, url: "https://attacker.example" }, { ...input, key: "browser-secret" }, { ...input, instruction: "x".repeat(1201) }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds declared and streamed body size and rejects cross-origin or non-JSON requests", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const external = request(input);
    external.headers.set("origin", "https://other.example");
    expect((await POST(external)).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/scene-description", { method: "POST", body: JSON.stringify(input) }))).status).toBe(415);
    expect((await POST(request({ text: "x".repeat(1024 * 1024) }))).status).toBe(413);
    const declared = request(input);
    declared.headers.set("content-length", String(1024 * 1024 + 1));
    expect((await POST(declared)).status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts the browser Host for an internally normalized localhost URL", async () => {
    vi.stubEnv("ASMR_PLANNER_API_KEY", "");
    const local = request({ ...input, provider: "api" });
    local.headers.set("host", "127.0.0.1:3001");
    local.headers.set("origin", "http://127.0.0.1:3001");
    expect((await POST(local)).status).toBe(503);
  });

  it("cancels an unfinished body and bounds its receive time without model dispatch", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const stream = new ReadableStream({ start(writer) { writer.enqueue(new TextEncoder().encode("{")); }, cancel: cancelled });
    const streamed = new Request("http://localhost/api/scene-description", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: stream, duplex: "half" } as RequestInit);
    const pending = POST(streamed);
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(cancelled).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const hanging = new ReadableStream({ start(writer) { writer.enqueue(new TextEncoder().encode("{")); } });
    const timeout = POST(new Request("http://localhost/api/scene-description", { method: "POST", headers: { "Content-Type": "application/json" }, body: hanging, duplex: "half" } as RequestInit));
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await timeout).status).toBe(408);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects fabricated shots and hides upstream private error details", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ sceneDescription: "A kitchen.", shots: [] }) } }))
      .mockRejectedValueOnce(new Error("private credential stack trace"));
    vi.stubGlobal("fetch", fetchImpl);
    expect((await POST(request(input))).status).toBe(502);
    const response = await POST(request(input));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private credential");
  });
});
