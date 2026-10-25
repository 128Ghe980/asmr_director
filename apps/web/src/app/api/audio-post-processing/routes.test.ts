import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "../../../lib/asmr/mock-project";
import { PlannerError } from "../../../lib/asmr/planner-provider";
import { planAudioPostProcessing, renderAudioPostProcessing } from "../../../lib/asmr/audio-post-processing-service";
import { POST as plan } from "./plan/route";
import { POST as render } from "./render/route";

vi.mock("../../../lib/asmr/audio-post-processing-service", async importOriginal => ({
  ...await importOriginal<object>(), planAudioPostProcessing: vi.fn(), renderAudioPostProcessing: vi.fn(),
}));
const request = (kind: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost/api/audio-post-processing/${kind}`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
beforeEach(() => vi.clearAllMocks());
describe("audio post-processing routes", () => {
  it("passes only validated projects and propagates cancellation to the service", async () => {
    vi.mocked(planAudioPostProcessing).mockResolvedValue({ processing: {} } as never);
    vi.mocked(renderAudioPostProcessing).mockResolvedValue({ receipt: {} } as never);
    const planResponse = await plan(request("plan", { project: demoProject, provider: "api" }));
    expect(planResponse.status).toBe(200);
    expect(planResponse.headers.get("cache-control")).toBe("no-store");
    expect(vi.mocked(planAudioPostProcessing).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect((await render(request("render", { project: demoProject, clipId: "clip_1" }))).status).toBe(200);
  });
  it("rejects cross-origin, browser paths, local providers and oversized requests before execution", async () => {
    expect((await plan(request("plan", { project: demoProject, provider: "api" }, { origin: "https://evil.invalid" }))).status).toBe(403);
    expect((await plan(request("plan", { project: demoProject, provider: "ollama" }))).status).toBe(400);
    expect((await render(request("render", { project: demoProject, clipId: "clip_1", inputWav: "C:/arbitrary.wav" }))).status).toBe(400);
    expect((await plan(request("plan", { project: demoProject, provider: "api" }, { "content-length": "1048577" }))).status).toBe(413);
    expect(planAudioPostProcessing).not.toHaveBeenCalled(); expect(renderAudioPostProcessing).not.toHaveBeenCalled();
  });
  it("keeps public errors safe and does not expose arbitrary renderer errors", async () => {
    vi.mocked(renderAudioPostProcessing).mockRejectedValueOnce(new PlannerError(409, "原音文件已变化。"));
    const response = await render(request("render", { project: demoProject, clipId: "clip_1" }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "原音文件已变化。" });
    vi.mocked(planAudioPostProcessing).mockRejectedValueOnce(new Error("private C:/secret"));
    const failed = await plan(request("plan", { project: demoProject, provider: "api" }));
    expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain("secret");
  });
});
