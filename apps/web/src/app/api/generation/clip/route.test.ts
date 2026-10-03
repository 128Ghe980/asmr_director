import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "@/lib/asmr/mock-project";
import { makeVoiceCandidateFixture } from "@/lib/asmr/voice-candidate-fixture";
import { generateLocalClip } from "@/lib/asmr/local-clip-generation";
import { readGenerationResponse } from "@/lib/asmr/generation-response";
import { VoxCpm2Error } from "@/lib/asmr/voxcpm2-error";
import { CandidateCapacityError } from "@/lib/asmr/local-candidate-store";
import { INSUFFICIENT_STORAGE, LocalStorageError } from "@/lib/asmr/local-storage-error";
import { POST } from "./route";
vi.mock("@/lib/asmr/local-clip-generation", () => ({ generateLocalClip: vi.fn() }));
vi.mock("@/lib/asmr/voice-provider-catalog", () => ({ getVoiceProviderCatalog: vi.fn() }));
const options = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip" };
const makeRequest = (body: unknown) => new Request("http://localhost/api/generation/clip", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
describe("clip generation API", () => {
  it("reports exhausted asset storage with a safe machine-readable 507 error", async () => {
    vi.mocked(generateLocalClip).mockRejectedValue(Object.assign(new Error("write private directory failed"), { code: "ENOSPC" }));
    const response = await POST(makeRequest({ project: demoProject, clipId: "voice_001", voiceOptions: options }));
    expect(response.status).toBe(507);
    expect(await response.json()).toEqual({ error: new LocalStorageError().message, code: INSUFFICIENT_STORAGE });
  });
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
    { project: demoProject, clipId: "voice_001", voiceOptions: { ...options, provider: "gpt-sovits", generationMode: "long_text" } },
  ])("rejects an invalid generation request before a provider is called", async (body) => {
    expect((await POST(makeRequest(body))).status).toBe(400);
    expect(generateLocalClip).not.toHaveBeenCalled();
  });
});

describe("long-text streaming generation API", () => {
  const longOptions = { ...options, generationMode: "long_text", analysisProvider: "local" };
  const longRequest = (signal?: AbortSignal, streaming = true) => new Request("http://localhost/api/generation/clip", {
    method: "POST", signal,
    headers: streaming ? { accept: "application/x-ndjson" } : {},
    body: JSON.stringify({ project: demoProject, clipId: "voice_001", reason: "generate", voiceOptions: longOptions }),
  });

  it("preserves storage error codes after the streaming headers have been sent", async () => {
    vi.mocked(generateLocalClip).mockRejectedValue(Object.assign(new Error("private audio output failed"), { code: "ENOSPC" }));
    const response = await POST(longRequest());
    expect(response.status).toBe(200);
    await expect(readGenerationResponse(response, vi.fn())).rejects.toMatchObject({ code: INSUFFICIENT_STORAGE, message: new LocalStorageError().message });
  });

  it("streams progress and final candidates using a cancelable validated request", async () => {
    const candidate = makeVoiceCandidateFixture();
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(generateLocalClip).mockImplementation(async (input) => {
      capturedSignal = input.signal;
      expect(input.voiceOptions).toEqual(longOptions);
      input.onProgress?.({ progress: 5, message: "分析文案" });
      input.onProgress?.({ progress: 65, message: "生成第 2 组" });
      return { candidate };
    });
    const response = await POST(longRequest());
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const progress = vi.fn();
    expect(await readGenerationResponse(response, progress)).toEqual({ candidate });
    expect(progress.mock.calls).toEqual([[5, "分析文案"], [65, "生成第 2 组"]]);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("preserves the JSON fallback and forwards its original request signal", async () => {
    const candidate = makeVoiceCandidateFixture();
    vi.mocked(generateLocalClip).mockResolvedValue({ candidate });
    const request = longRequest(undefined, false);
    const response = await POST(request);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ candidate });
    expect(generateLocalClip).toHaveBeenCalledWith(expect.objectContaining({ voiceOptions: longOptions, signal: request.signal }));
  });

  it.each([
    [new VoxCpm2Error("第 2 组未通过检查。"), "第 2 组未通过检查。"],
    [new CandidateCapacityError(), "此片段已有 12 个候选"],
    [new Error("private runtime path and diagnostic"), "生成未完成。已保存的完整原音仍可试听、下载。"],
  ])("emits safe generation failures in the response stream", async (error, expected) => {
    vi.mocked(generateLocalClip).mockRejectedValue(error);
    const response = await POST(longRequest());
    expect(response.status).toBe(200); // Headers have already started streaming.
    await expect(readGenerationResponse(response, vi.fn())).rejects.toThrow(expected as string);
  });

  it("forwards request abort, suppresses late results and cleans up heartbeat timers", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(generateLocalClip).mockImplementation((input) => {
      capturedSignal = input.signal;
      return new Promise((resolve) => { finish = () => resolve({ candidate: makeVoiceCandidateFixture() }); });
    });
    const controller = new AbortController();
    const response = await POST(longRequest(controller.signal));
    const reading = response.text();
    await vi.advanceTimersByTimeAsync(15_000);
    controller.abort();
    expect(capturedSignal?.aborted).toBe(true);
    finish();
    const body = await reading;
    expect(body).toContain('"type":"heartbeat"');
    expect(body).not.toContain('"type":"result"');
    expect(body).not.toContain('"type":"error"');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates response-reader cancellation to the provider", async () => {
    let finish!: () => void;
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(generateLocalClip).mockImplementation((input) => {
      capturedSignal = input.signal;
      return new Promise((resolve) => { finish = () => resolve({ candidate: makeVoiceCandidateFixture() }); });
    });
    const response = await POST(longRequest());
    await response.body!.cancel();
    expect(capturedSignal?.aborted).toBe(true);
    finish();
  });
});
