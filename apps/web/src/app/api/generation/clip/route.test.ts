import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "@/lib/asmr/mock-project";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { generateLocalClip } from "@/lib/asmr/local-clip-generation";
import { POST } from "./route";
vi.mock("@/lib/asmr/local-clip-generation", () => ({ generateLocalClip: vi.fn() }));
vi.mock("@/lib/asmr/voice-provider-catalog", () => ({ getVoiceProviderCatalog: vi.fn() }));
const options = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip" };
const makeRequest = (body: unknown) => new Request("http://localhost/api/generation/clip", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.clearAllMocks());
describe("clip generation API", () => {
  it("returns a candidate and forwards only validated options with cancellation", async () => {
    const candidate = makeVoiceCandidateFixture();
    vi.mocked(generateLocalClip).mockResolvedValue({ candidate });
    const response = await POST(makeRequest({ project: demoProject, clipId: "voice_001", reason: "generate", voiceOptions: options }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ candidate });
    expect(generateLocalClip).toHaveBeenCalledWith(expect.objectContaining({ voiceOptions: options, signal: expect.any(AbortSignal) }));
  });
  it.each([
    { project: {}, clipId: "voice_001" },
    { project: demoProject, clipId: "voice_001", voiceOptions: { ...options, referencePath: "C:/private.wav" } },
    { project: demoProject, clipId: "breath_001", voiceOptions: options },
    { project: demoProject, clipId: "missing" },
  ])("rejects an invalid generation request before a provider is called", async (body) => {
    expect((await POST(makeRequest(body))).status).toBe(400);
    expect(generateLocalClip).not.toHaveBeenCalled();
  });
});
