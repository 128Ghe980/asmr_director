import { describe, expect, it, vi } from "vitest";
import { selectVoiceBoundaryWithApi } from "./voice-boundary-api";
import type { VoiceRecognition } from "./voice-recognition";

const env = { ASMR_PLANNER_API_URL: "https://example.test/v1", ASMR_PLANNER_API_MODEL: "fixture-model", ASMR_PLANNER_API_KEY: "fixture-only" };
const recognizedPrefix = "来面来了慢点吃小心烫汤也喝一点暖胃";
const evidence: VoiceRecognition = {
  stage: "source_alignment", expectedText: "来~~，面来啦！慢点儿吃，小心烫。汤也喝一点，暖胃。", followingText: "今天外面风大。",
  sourceTranscript: `${recognizedPrefix}今天外面风大`,
  sourceWords: Array.from(`${recognizedPrefix}今天外面风大`).map((text, index) => ({ text, start: index * .2, end: (index + 1) * .2 })),
  endpointCandidates: [{ terminalWordIndex: 16, recognizedPrefix, similarity: .888889 }],
};

function response(value: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }] }), { status: 200 });
}

describe("optional API selection of an existing recognized endpoint", () => {
  it("sends only bounded text/indexes and accepts only the matching existing candidate", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ terminalWordIndex: 16 }));
    await expect(selectVoiceBoundaryWithApi(evidence, { env, fetchImpl })).resolves.toEqual({ terminalWordIndex: 16, recognizedPrefix });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    const body = JSON.parse(request.body);
    const sent = JSON.parse(body.messages[1].content);
    expect(sent).toMatchObject({ expectedText: evidence.expectedText, followingText: evidence.followingText, candidates: evidence.endpointCandidates });
    expect(sent.words[0]).toEqual({ index: 0, text: "来" });
    expect(body.messages[0].content).toContain("不可信");
    expect(body.messages[0].content).toContain("不返回秒数");
    expect(body.messages[0].content).toMatch(/json/i);
    expect(request.body).not.toContain("fixture-only");
    expect(request.body).not.toMatch(/"start"|"end"|"wav"|"modelPath"/);
  });

  it("meets compatible API JSON-mode prompt requirements without request repair or retries", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.response_format?.type === "json_object" && !body.messages.some((message: { content: string }) => /json/i.test(message.content))) {
        return Response.json({ error: { message: "Prompt must contain the word 'json'.", type: "invalid_request_error" } }, { status: 400 });
      }
      return response({ terminalWordIndex: 16 });
    });
    await expect(selectVoiceBoundaryWithApi(evidence, { env, fetchImpl })).resolves.toEqual({ terminalWordIndex: 16, recognizedPrefix });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    [16, "selected"], [null, "declined"], [100, "unavailable"],
  ])("reports a small safe API status for decision %s", async (terminalWordIndex, status) => {
    const onStatus = vi.fn();
    await selectVoiceBoundaryWithApi(evidence, { env, onStatus, fetchImpl: vi.fn().mockResolvedValue(response({ terminalWordIndex })) });
    expect(onStatus).toHaveBeenCalledExactlyOnceWith({ status, model: "fixture-model" });
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain("fixture-only");
  });

  it("reports unconfigured or failed API status without inventing a decision", async () => {
    const unconfigured = vi.fn();
    await selectVoiceBoundaryWithApi(evidence, { env: {}, onStatus: unconfigured });
    expect(unconfigured).toHaveBeenCalledExactlyOnceWith({ status: "unavailable" });
    const failed = vi.fn();
    await selectVoiceBoundaryWithApi(evidence, { env, onStatus: failed, fetchImpl: vi.fn().mockResolvedValue(new Response("busy", { status: 503 })) });
    expect(failed).toHaveBeenCalledExactlyOnceWith({ status: "unavailable", model: "fixture-model" });
  });

  it.each([
    { terminalWordIndex: null }, { terminalWordIndex: 15 }, { terminalWordIndex: 17 },
    { terminalWordIndex: 16.5 }, { terminalWordIndex: "16" }, { terminalWordIndex: 16, cutEndSeconds: 7.275 },
  ])("declines malformed, invented or absent index decisions: %j", async (decision) => {
    const fetchImpl = vi.fn().mockResolvedValue(response(decision));
    await expect(selectVoiceBoundaryWithApi(evidence, { env, fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("skips unconfigured API, missing evidence and invalid candidate lists without requests", async () => {
    const fetchImpl = vi.fn();
    await expect(selectVoiceBoundaryWithApi(evidence, { env: {}, fetchImpl })).resolves.toBeNull();
    for (const value of [
      { ...evidence, stage: "boundary_check" }, { ...evidence, sourceWords: undefined },
      { ...evidence, followingText: "" }, { ...evidence, endpointCandidates: undefined },
      { ...evidence, endpointCandidates: [{ ...evidence.endpointCandidates![0], terminalWordIndex: 100 }] },
      { ...evidence, endpointCandidates: [evidence.endpointCandidates![0], evidence.endpointCandidates![0]] },
    ]) await expect(selectVoiceBoundaryWithApi(value as VoiceRecognition, { env, fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps provider errors and timeouts advisory and never retries", async () => {
    const failing = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    await expect(selectVoiceBoundaryWithApi(evidence, { env, fetchImpl: failing })).resolves.toBeNull();
    expect(failing).toHaveBeenCalledOnce();
    const hanging = vi.fn(() => new Promise<Response>(() => {}));
    await expect(selectVoiceBoundaryWithApi(evidence, { env, fetchImpl: hanging, timeoutMs: 5 })).resolves.toBeNull();
    expect(hanging).toHaveBeenCalledOnce();
  });

  it("propagates cancellation before request and during an unresponsive provider", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const onStatus = vi.fn();
    await expect(selectVoiceBoundaryWithApi(evidence, { env, fetchImpl, signal: AbortSignal.abort() })).rejects.toMatchObject({ status: 499 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = selectVoiceBoundaryWithApi(evidence, { env, fetchImpl, onStatus, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ status: 499 });
    controller.abort();
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onStatus).not.toHaveBeenCalled();
  });
});
