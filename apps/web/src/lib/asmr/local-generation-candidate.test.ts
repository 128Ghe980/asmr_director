import { describe, expect, it, vi } from "vitest";
import type { GenerationJobUpdate } from "./generation-bridge";
import { createLocalGenerationBridge } from "./local-generation-bridge";
import { demoProject } from "./mock-project";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";

const request = {
  project: demoProject, clipId: "voice_001", reason: "generate" as const,
  voiceOptions: { provider: "voxcpm2" as const, voicePackId: "soft_zh",
    referenceMode: "with_reference_text" as const, generationMode: "clip" as const },
};

describe("local voice candidate bridge", () => {
  it("returns a candidate event instead of an asset commit", async () => {
    const candidate = makeVoiceCandidateFixture();
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ candidate }));
    const updates: GenerationJobUpdate[] = [];
    await createLocalGenerationBridge({ fetchImpl }).generateClip(request, (update) => updates.push(update));
    expect(updates.at(-1)).toMatchObject({ type: "candidate", candidate, job: { status: "succeeded" } });
    expect(updates.some((update) => update.type === "succeeded")).toBe(false);
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string).voiceOptions).toEqual(request.voiceOptions);
  });

  it("aborts the request and does not deliver late candidates", async () => {
    let finish!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const bridge = createLocalGenerationBridge({ fetchImpl, jobIdPrefix: "cancel" });
    const updates: GenerationJobUpdate[] = [];
    const pending = bridge.generateClip(request, (update) => updates.push(update));
    await bridge.cancelGeneration("cancel_1");
    expect(signal?.aborted).toBe(true);
    finish(Response.json({ candidate: makeVoiceCandidateFixture() }));
    await pending;
    expect(updates.map((update) => update.type)).toEqual(["snapshot", "snapshot", "canceled"]);
  });

  it("rejects a candidate belonging to a different request", async () => {
    const updates: GenerationJobUpdate[] = [];
    await createLocalGenerationBridge({
      fetchImpl: vi.fn(async () => Response.json({ candidate: makeVoiceCandidateFixture({ clipId: "voice_other" }) })),
    }).generateClip(request, (update) => updates.push(update));
    expect(updates.at(-1)).toMatchObject({ type: "failed" });
  });
});
