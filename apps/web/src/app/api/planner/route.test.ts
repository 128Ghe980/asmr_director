import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/planner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/api/planner", () => {
  it("returns only the provider catalogue and makes no upstream request", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("ASMR_PLANNER_API_KEY", "server-secret");
    vi.stubEnv("ASMR_PLANNER_API_URL", "https://private-provider.example/v1");
    vi.stubEnv("ASMR_PLANNER_API_MODEL", "configured-model");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.providers).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("server-secret");
    expect(JSON.stringify(body)).not.toContain("private-provider.example");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, unsupported providers and extra endpoint/key fields", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const malformed = await POST(new Request("http://localhost/api/planner", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }));
    expect(malformed.status).toBe(400);
    for (const body of [
      { action: "generate", provider: "other", brief: { theme: "深夜书店" } },
      { action: "generate", provider: "ollama", brief: { theme: " " } },
      { action: "generate", provider: "ollama", brief: { theme: "深夜书店" }, url: "https://attacker.example" },
      { action: "generate", provider: "api", brief: { theme: "深夜书店" }, key: "user-key" },
      { action: "rewrite", provider: "ollama", brief: { theme: "深夜书店" }, instruction: "重写" },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies with or without a declared Content-Length", async () => {
    const oversized = request({ notes: "x".repeat(128 * 1024) });
    const response = await POST(oversized);
    expect(response.status).toBe(413);
    const declared = new Request("http://localhost/api/planner", {
      method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(129 * 1024) }, body: "{}",
    });
    expect((await POST(declared)).status).toBe(413);
  });

  it("rejects cross-origin and non-JSON requests before calling the model", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const crossOrigin = request({ action: "generate", provider: "ollama", brief: { theme: "书店" } });
    crossOrigin.headers.set("origin", "https://another-site.example");
    expect((await POST(crossOrigin)).status).toBe(403);
    const plain = new Request("http://localhost/api/planner", {
      method: "POST", body: JSON.stringify({ action: "generate", provider: "ollama", brief: { theme: "书店" } }),
    });
    expect((await POST(plain)).status).toBe(415);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts the browser Host when Next normalizes the internal request URL", async () => {
    vi.stubEnv("ASMR_PLANNER_API_KEY", "");
    const local = request({ action: "generate", provider: "api", brief: { theme: "书店" } });
    local.headers.set("host", "127.0.0.1:3000");
    local.headers.set("origin", "http://127.0.0.1:3000");
    // It reaches the configured-provider check instead of being mistaken for CSRF.
    expect((await POST(local)).status).toBe(503);
  });

  it("returns a real validated provider result without infrastructure fields", async () => {
    const section = {
      kind: "speech", purpose: "dialogue",
      id: "one", title: "开场", text: "进来坐一会儿吧。", emotion: "温柔", style: "轻声", pace: "slow",
      direction: "自然留白", soundSuggestions: "翻书声", pauseAfter: "medium",
      position: { pan: 0, distance: "near", movement: "static" },
    };
    const draft = {
      performanceVersion: 1,
      title: "深夜书店", scene: "夜晚书店", character: { role: "店员", personality: ["耐心"], speechStyle: ["轻声"] },
      sections: [section, { ...section, id: "paper", title: "慢慢翻书", kind: "silent", purpose: "asmr", durationSeconds: 50,
        text: "稳稳托住同一本书，慢慢翻动书页，在纸张声之间留出安静间隙。", direction: "起始：双手托着书；动作：逐页缓慢翻动；结束：书仍留在手中。" },
      { ...section, id: "two", title: "收尾" }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: { content: JSON.stringify(draft) } })));
    const response = await POST(request({ action: "generate", provider: "ollama", brief: { theme: "深夜书店", durationSeconds: 60 } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ draft, provider: "ollama" });
  });

  it("reports missing API configuration and hides unexpected provider error details", async () => {
    vi.stubEnv("ASMR_PLANNER_API_KEY", "");
    const missing = await POST(request({ action: "generate", provider: "api", brief: { theme: "深夜书店" } }));
    expect(missing.status).toBe(503);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("server-secret stack trace")));
    const offline = await POST(request({ action: "generate", provider: "ollama", brief: { theme: "深夜书店" } }));
    expect(offline.status).toBe(503);
    expect(await offline.text()).not.toContain("server-secret");
  });
});
