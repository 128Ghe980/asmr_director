import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateCapacityError } from "@/lib/asmr/local-candidate-store";
import { demoProject } from "@/lib/asmr/mock-project";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { VoiceCandidateRecheckError } from "@/lib/asmr/voice-candidate-recheck";
import { VoxCpm2Error } from "@/lib/asmr/voxcpm2-error";
import { POST } from "./route";

const hooks = vi.hoisted(() => ({ recheck: vi.fn(), config: { runtimeRoot: "isolated-runtime" } }));
vi.mock("@/lib/asmr/local-runtime-config", () => ({ getLocalRuntimeConfig: () => hooks.config }));
vi.mock("@/lib/asmr/voice-candidate-recheck", async (original) => ({ ...await original<typeof import("@/lib/asmr/voice-candidate-recheck")>(), recheckVoiceCandidate: hooks.recheck }));
function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/audio-candidates/candidate_fixture_1/recheck", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
}
const context = { params: Promise.resolve({ candidateId: "candidate_fixture_1" }) };
beforeEach(() => { hooks.recheck.mockReset(); hooks.recheck.mockResolvedValue({ candidate: makeVoiceCandidateFixture({ candidateId: "rechecked_new" }) }); });

describe("POST /api/audio-candidates/[candidateId]/recheck", () => {
  it("passes only the validated current project snapshot and request cancellation to local recognition", async () => {
    const controller = new AbortController();
    const input = request({ project: demoProject, clipId: "voice_001" }, controller.signal);
    const response = await POST(input, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ candidate: makeVoiceCandidateFixture({ candidateId: "rechecked_new" }) });
    expect(hooks.recheck).toHaveBeenCalledOnce();
    expect(hooks.recheck).toHaveBeenCalledWith({ project: demoProject, clipId: "voice_001", candidateId: "candidate_fixture_1",
      config: hooks.config, signal: input.signal });
  });
  it.each([{}, { project: demoProject }, { project: demoProject, clipId: "voice_001", seed: 123 },
    { project: demoProject, clipId: "../voice_001" }, { project: { project_id: "invalid" }, clipId: "voice_001" },
    { project: demoProject, clipId: "unknown_clip" }])("rejects invalid request %j before recognition", async (body) => {
    const response = await POST(request(body), context);
    expect(response.status).toBe(400);
    expect(hooks.recheck).not.toHaveBeenCalled();
  });
  it("rejects unsafe candidate IDs and malformed JSON without exposing filesystem paths", async () => {
    const badId = await POST(request({ project: demoProject, clipId: "voice_001" }), { params: Promise.resolve({ candidateId: "../private" }) });
    expect(badId.status).toBe(400);
    const malformed = await POST(new Request("http://localhost/recheck", { method: "POST", body: "{wrong" }), context);
    expect(malformed.status).toBe(400);
    expect(hooks.recheck).not.toHaveBeenCalled();
  });
  it.each([new VoiceCandidateRecheckError("原音未找到", 422), new VoiceCandidateRecheckError("文案已修改", 409),
    new VoxCpm2Error("本机正在运行语音任务", 409), new CandidateCapacityError(), new VoiceCandidateRecheckError("识别环境未就绪", 503)])(
    "preserves actionable safe server errors %s", async (error) => {
      hooks.recheck.mockRejectedValueOnce(error);
      const response = await POST(request({ project: demoProject, clipId: "voice_001" }), context);
      expect(response.status).toBe(error.statusCode);
      expect(await response.json()).toEqual({ error: error.message });
    });
  it("retains fresh recognition checkpoint when a safe analysis error supplies one", async () => {
    const recognition = { stage: "target_validation" as const, sourceTranscript: "实际识别文本", expectedText: "目标台词" };
    hooks.recheck.mockRejectedValueOnce(new VoiceCandidateRecheckError("未确认截取", 422, recognition));
    const response = await POST(request({ project: demoProject, clipId: "voice_001" }), context);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "未确认截取", recognition });
  });
  it("responds to client cancellation and hides unexpected server details", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await POST(request({ project: demoProject, clipId: "voice_001" }, controller.signal), context);
    expect(cancelled.status).toBe(499);
    expect(hooks.recheck).not.toHaveBeenCalled();
    hooks.recheck.mockRejectedValueOnce(new Error("private I:/AI/full-original.wav"));
    const failure = await POST(request({ project: demoProject, clipId: "voice_001" }), context);
    expect(failure.status).toBe(500);
    expect(JSON.stringify(await failure.json())).not.toContain("I:/AI");
  });
});
