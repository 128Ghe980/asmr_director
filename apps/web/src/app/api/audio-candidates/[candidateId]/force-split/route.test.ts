import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateCapacityError } from "@/lib/asmr/local-candidate-store";
import { demoProject } from "@/lib/asmr/mock-project";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { VoiceCandidateRecheckError } from "@/lib/asmr/voice-candidate-recheck";
import { VoiceForcedAlignmentError } from "@/lib/asmr/voice-forced-alignment";
import { POST } from "./route";

const hooks = vi.hoisted(() => ({ force: vi.fn(), config: { runtimeRoot: "isolated-runtime" } }));
vi.mock("@/lib/asmr/local-runtime-config", () => ({ getLocalRuntimeConfig: () => hooks.config }));
vi.mock("@/lib/asmr/voice-candidate-recheck", async original => ({
  ...await original<typeof import("@/lib/asmr/voice-candidate-recheck")>(), forceSplitVoiceCandidate: hooks.force,
}));
const context = { params: Promise.resolve({ candidateId: "candidate_fixture_1" }) };
function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/audio-candidates/candidate_fixture_1/force-split", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}
beforeEach(() => { hooks.force.mockReset(); hooks.force.mockResolvedValue({ candidate: makeVoiceCandidateFixture({ candidateId: "forced_new" }) }); });

describe("POST /api/audio-candidates/[candidateId]/force-split", () => {
  it("passes only the current project and explicit candidate identity without adopting a result", async () => {
    const input = request({ project: demoProject, clipId: "voice_001" });
    const response = await POST(input, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ candidate: makeVoiceCandidateFixture({ candidateId: "forced_new" }) });
    expect(hooks.force).toHaveBeenCalledExactlyOnceWith({ project: demoProject, clipId: "voice_001", candidateId: "candidate_fixture_1",
      config: hooks.config, signal: input.signal });
  });
  it.each([{}, { project: demoProject }, { project: demoProject, clipId: "voice_001", cutFrames: [100] },
    { project: demoProject, clipId: "voice_001", force: true }, { project: demoProject, clipId: "../voice_001" },
    { project: demoProject, clipId: "unknown" }])("rejects unsupported or client-supplied timing inputs %j", async body => {
    expect((await POST(request(body), context)).status).toBe(400);
    expect(hooks.force).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and unsafe candidate IDs before opening a source", async () => {
    expect((await POST(new Request("http://localhost/force-split", { method: "POST", body: "{bad" }), context)).status).toBe(400);
    expect((await POST(request({ project: demoProject, clipId: "voice_001" }), {
      params: Promise.resolve({ candidateId: "../private" }) })).status).toBe(400);
    expect(hooks.force).not.toHaveBeenCalled();
  });
  it.each([new VoiceCandidateRecheckError("原音归属不明", 422), new VoiceCandidateRecheckError("文案已改变", 409),
    new CandidateCapacityError(), new VoiceForcedAlignmentError("给定文案中有模型不能处理的字符", 422, "oov_characters")])(
    "preserves actionable execution errors %s", async error => {
      hooks.force.mockRejectedValueOnce(error);
      const response = await POST(request({ project: demoProject, clipId: "voice_001" }), context);
      expect(response.status).toBe(error.statusCode);
      expect(await response.json()).toEqual({ error: error.message,
        ...(error instanceof VoiceForcedAlignmentError ? { code: error.diagnosticCode } : {}) });
    });
  it("cancels immediately and does not expose unexpected filesystem details", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await POST(request({ project: demoProject, clipId: "voice_001" }, controller.signal), context)).status).toBe(499);
    expect(hooks.force).not.toHaveBeenCalled();
    hooks.force.mockRejectedValueOnce(new Error("private I:/AI/source.wav"));
    const failed = await POST(request({ project: demoProject, clipId: "voice_001" }), context);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("I:/AI");
  });
});
