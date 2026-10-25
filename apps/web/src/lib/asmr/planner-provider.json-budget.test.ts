import { describe, expect, it, vi } from "vitest";
import { completePlannerJson } from "./planner-provider";

describe("server-side structured JSON output budgets", () => {
  it.each([
    [{ maxTokens: 50_000 }, 8192],
    [{ maxTokens: 50_000, tokenLimit: 16_384 }, 16_384],
    [{ maxTokens: 50_000, tokenLimit: 50_000 }, 16_384],
    [{ maxTokens: 50_000, tokenLimit: NaN }, 8192],
    [{ maxTokens: -10, tokenLimit: 16_384 }, 1],
    [{ tokenLimit: 100 }, 100],
  ])("keeps explicit and default budgets bounded: %j", async (options, expected) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" } }] }));
    await completePlannerJson({ provider: "api", messages: [{ role: "user", content: "JSON" }], jsonSchema: {} }, {
      ...options, env: { ASMR_PLANNER_API_URL: "https://test.invalid/v1", ASMR_PLANNER_API_KEY: "test-only", ASMR_PLANNER_API_MODEL: "mock" }, fetchImpl,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).max_tokens).toBe(expected);
  });
});
