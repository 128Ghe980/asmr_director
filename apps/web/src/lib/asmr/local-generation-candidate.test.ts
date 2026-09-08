import { describe, expect, it, vi } from "vitest";
import type { GenerationJobUpdate } from "./generation-bridge";
import { createLocalGenerationBridge } from "./local-generation-bridge";
import { demoProject } from "./mock-project";
import { makeVoiceCandidateFixture, makeVoiceLongTextResultFixture } from "./voice-candidate-fixture";
import { getVoiceCandidateRequestFingerprint, type AudioCandidate } from "./audio-candidate";
import { flattenClips } from "./view-model";

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

describe("long-text candidate streaming bridge", () => {
  const longRequest = { ...request, voiceOptions: { ...request.voiceOptions, generationMode: "long_text" as const, analysisProvider: "local" as const } };
  const longCandidate = (): AudioCandidate => {
    const candidate = makeVoiceCandidateFixture();
    const voice = flattenClips(demoProject).find((clip) => clip.id === request.clipId)!;
    return { ...candidate, requestFingerprint: getVoiceCandidateRequestFingerprint(voice, longRequest.voiceOptions), provenance: { ...candidate.provenance, generationMode: "long_text" as const, longText: makeVoiceLongTextResultFixture() } };
  };
  const encoder = new TextEncoder();
  const ndjson = (events: unknown[]) => new Response(events.map((event) => JSON.stringify(event)).join("\n"), { headers: { "content-type": "application/x-ndjson" } });

  it("requests NDJSON and emits real group progress followed by one candidate", async () => {
    const candidate = longCandidate();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ndjson([
      { type: "progress", progress: 8, message: "分析文案" },
      { type: "heartbeat" },
      { type: "progress", progress: 62, message: "生成第 2 组" },
      { type: "result", result: { candidate } },
    ]));
    const updates: GenerationJobUpdate[] = [];
    await createLocalGenerationBridge({ fetchImpl }).generateClip(longRequest, (update) => updates.push(update));
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ accept: "application/x-ndjson" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string).voiceOptions).toEqual(longRequest.voiceOptions);
    expect(updates.filter((update) => update.type === "snapshot").map((update) => update.job.progress)).toEqual([0, 1, 8, 62]);
    expect(updates.at(-1)).toMatchObject({ type: "candidate", candidate });
    expect(updates.some((update) => update.type === "succeeded")).toBe(false);
  });

  it("ignores streamed progress and a late result after user cancellation", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } }), { headers: { "content-type": "application/x-ndjson" } });
    });
    const bridge = createLocalGenerationBridge({ fetchImpl, jobIdPrefix: "stream_cancel" });
    const updates: GenerationJobUpdate[] = [];
    const pending = bridge.generateClip(longRequest, (update) => updates.push(update));
    await bridge.cancelGeneration("stream_cancel_1");
    expect(signal?.aborted).toBe(true);
    streamController.enqueue(encoder.encode(JSON.stringify({ type: "progress", progress: 90, message: "迟到进度" }) + "\n"));
    streamController.enqueue(encoder.encode(JSON.stringify({ type: "result", result: { candidate: longCandidate() } }) + "\n"));
    streamController.close();
    await pending;
    expect(updates.map((update) => update.type)).toEqual(["snapshot", "snapshot", "canceled"]);
  });

  it("rejects a candidate with a different generation mode even if its request fingerprint matches", async () => {
    const candidate = longCandidate();
    candidate.provenance = { ...candidate.provenance, generationMode: "clip" };
    delete candidate.provenance.longText;
    const updates: GenerationJobUpdate[] = [];
    await createLocalGenerationBridge({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(ndjson([{ type: "result", result: { candidate } }])) })
      .generateClip(longRequest, (update) => updates.push(update));
    expect(updates.at(-1)).toMatchObject({ type: "failed", error: "候选与本次生成请求不匹配，请重试。" });
    expect(updates.some((update) => update.type === "candidate")).toBe(false);
  });

  it.each([
    [[{ type: "error", error: "第 3 组检查未通过。" }], "第 3 组检查未通过。"],
    [[{ type: "progress", progress: 50, message: "生成中" }], "未收到完整候选"],
  ])("fails without adopting audio when the server fails or the stream ends early", async (events, expected) => {
    const updates: GenerationJobUpdate[] = [];
    await createLocalGenerationBridge({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(ndjson(events as unknown[])) })
      .generateClip(longRequest, (update) => updates.push(update));
    expect(updates.at(-1)).toMatchObject({ type: "failed", error: expect.stringContaining(expected as string) });
    expect(updates.some((update) => update.type === "candidate" || update.type === "succeeded")).toBe(false);
  });
});
