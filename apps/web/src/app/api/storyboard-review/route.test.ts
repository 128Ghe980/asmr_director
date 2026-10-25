import { beforeEach, describe, expect, it, vi } from "vitest";
import { postProcessingProject } from "../../../components/studio/audio-post-processing-test-fixture";
import { generateStoryboardReview } from "../../../lib/asmr/storyboard-review-service";
import { PlannerError } from "../../../lib/asmr/planner-provider";
import { POST } from "./route";

vi.mock("../../../lib/asmr/storyboard-review-service", async importOriginal => ({ ...await importOriginal<object>(), generateStoryboardReview: vi.fn() }));
function request(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const project = postProcessingProject();
  return new Request("http://localhost/api/storyboard-review", { method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ project, editableClipIds: Object.keys(project.videoPlan!.shots), ...extra }) });
}
beforeEach(() => vi.clearAllMocks());
describe("POST /api/storyboard-review", () => {
  it("passes a bounded validated request with cancellation and no-store response", async () => {
    vi.mocked(generateStoryboardReview).mockResolvedValue({ review: { inputFingerprint: "storyboard-review-v1:" + "a".repeat(32), changes: [], notes: [] }, provider: "api", model: "mock" });
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(vi.mocked(generateStoryboardReview).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it("rejects local provider, arbitrary metadata, cross-origin and oversized requests before dispatch", async () => {
    for (const extra of [{ provider: "ollama" }, { filePath: "C:/secret.wav" }, { editableClipIds: "all" }, { project: {} }]) expect((await POST(request(extra))).status).toBe(400);
    expect((await POST(request({}, { origin: "https://foreign.invalid" }))).status).toBe(403);
    expect((await POST(request({}, { "content-length": "1048577" }))).status).toBe(413);
    expect(generateStoryboardReview).not.toHaveBeenCalled();
  });
  it("preserves safe failure status but does not leak arbitrary exception paths", async () => {
    vi.mocked(generateStoryboardReview).mockRejectedValueOnce(new PlannerError(409, "当前分镜已变化。"));
    const conflict = await POST(request()); expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: "当前分镜已变化。" });
    vi.mocked(generateStoryboardReview).mockRejectedValueOnce(new Error("private C:/key"));
    const failure = await POST(request()); expect(failure.status).toBe(500); expect(JSON.stringify(await failure.json())).not.toContain("private");
  });
});
