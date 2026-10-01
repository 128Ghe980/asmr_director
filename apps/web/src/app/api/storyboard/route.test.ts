import { afterEach, describe, expect, it, vi } from "vitest";

import { createStoryboardSourceFingerprint } from "../../../lib/asmr/storyboard";
import { POST } from "./route";

const section = {
  id: "one", title: "开场", text: "进来坐一会儿吧。", emotion: "温柔", style: "轻声", pace: "slow", direction: "自然留白", soundSuggestions: "翻书声", pauseAfter: "medium",
  position: { pan: 0, distance: "near" as const, movement: "static" as const },
};
const draft = { title: "深夜书店", scene: "夜晚书店", character: { role: "店员", personality: ["耐心"], speechStyle: ["轻声"] }, sections: [{ ...section, pauseAfter: "medium" as const }] };
const input = { provider: "ollama", draft };
const generated = { title: "书店的小灯", shots: [{ id: "shot_1", title: "暖光迎接", sourceSectionIds: ["one"], visual: "暖黄色小灯映着书架。", action: "店员请客人坐下。", camera: "固定中景。" }] };
function request(body: unknown) {
  return new Request("http://localhost/api/storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("/api/storyboard", () => {
  it("returns a validated standalone storyboard with a locally bound writing source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: { content: JSON.stringify(generated) } })));
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ storyboard: { ...generated, version: 1, sourceFingerprint: createStoryboardSourceFingerprint(draft) }, provider: "ollama" });
  });

  it("rejects invalid JSON, incomplete drafts, unsupported provider or browser-supplied infrastructure", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const malformed = new Request("http://localhost/api/storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    for (const body of [{ ...input, draft: { ...draft, sections: [] } }, { ...input, provider: "other" }, { ...input, url: "https://attacker.example" }, { ...input, key: "user-key" }, { ...input, instruction: "x".repeat(1201) }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, non-JSON and oversized bodies before dispatch", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const crossOrigin = request(input);
    crossOrigin.headers.set("origin", "https://other-site.example");
    expect((await POST(crossOrigin)).status).toBe(403);
    const plain = new Request("http://localhost/api/storyboard", { method: "POST", body: JSON.stringify(input) });
    expect((await POST(plain)).status).toBe(415);
    const oversized = request({ content: "x".repeat(1024 * 1024) });
    expect((await POST(oversized)).status).toBe(413);
    const declared = request(input);
    declared.headers.set("content-length", String(1024 * 1024 + 1));
    expect((await POST(declared)).status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the browser Host to match a 127.0.0.1 origin normalized internally to localhost", async () => {
    vi.stubEnv("ASMR_PLANNER_API_KEY", "");
    const local = request({ ...input, provider: "api" });
    local.headers.set("host", "127.0.0.1:3001");
    local.headers.set("origin", "http://127.0.0.1:3001");
    expect((await POST(local)).status).toBe(503);
  });

  it("bounds a hanging request body and cancels reading when the browser aborts", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const stream = new ReadableStream({ start(writer) { writer.enqueue(new TextEncoder().encode("{")); }, cancel: cancelled });
    const streamed = new Request("http://localhost/api/storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: stream, duplex: "half" } as RequestInit);
    const pending = POST(streamed);
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(await response.text()).toContain("取消");
  });

  it("reports body receive timeout without calling a model", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const stream = new ReadableStream({ start(writer) { writer.enqueue(new TextEncoder().encode("{")); } });
    const pending = POST(new Request("http://localhost/api/storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit));
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await pending).status).toBe(408);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hides upstream internals and refuses partial or mismatched generated shots", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("private credential stack trace"))
      .mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ ...generated, shots: [{ ...generated.shots[0], sourceSectionIds: ["other"] }] }) } }));
    vi.stubGlobal("fetch", fetchImpl);
    const offline = await POST(request(input));
    expect(offline.status).toBe(503);
    expect(await offline.text()).not.toContain("private credential");
    expect((await POST(request(input))).status).toBe(502);
  });
});
