import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16MonoWav } from "./procedural-audio";
import { analyzeVoiceGroup, getVoiceAnalysisReadiness, shouldReuseVoiceAnalysis, VoiceGroupAnalysisError, type VoiceAnalysisSpawn } from "./voice-group-analysis";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

async function fixture() {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "voice-analysis-"));
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: runtimeRoot });
  const wav = writePcm16MonoWav(new Float32Array(48_000).fill(.05), 48_000);
  const input = { wav, expectedText: "慢慢放松。", clauses: ["慢慢放松"], config };
  const readinessImpl = async () => ({ pythonPath: path.join(runtimeRoot, "python.exe"), modelPath: path.join(runtimeRoot, "model") });
  return { runtimeRoot, input, readinessImpl };
}

function child() {
  const result = Object.assign(new EventEmitter(), {
    pid: 987654321,
    kill: vi.fn((signal: NodeJS.Signals) => { queueMicrotask(() => result.emit("close", null, signal)); return true; }),
  });
  return result;
}

const validResult = {
  version: 1, success: true, internalPausesMs: [], leadingQuietMs: 0, trailingQuietMs: 0,
  transcript: "慢慢放松", coverage: 1, cutStartSeconds: 0, cutEndSeconds: 1,
  asrModel: "faster-whisper-large-v3/cpu/int8",
};

const recognition = {
  stage: "source_alignment" as const, sourceTranscript: "慢慢放松，后续原文。", expectedText: "慢慢放松。",
  sourceWords: [{ text: "慢慢", start: 0.1, end: 0.3 }, { text: "放松", start: 0.3, end: 0.6 }],
  alignment: { expected: "慢慢放松", recognizedPrefix: "慢慢放松后续", reason: "uncertain_word_alignment" },
};

function successfulSpawn(wav: Uint8Array, response: unknown = validResult, expectedText = "慢慢放松。", followingText = ""): VoiceAnalysisSpawn {
  return vi.fn((_command, args, options) => {
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: "ignore", env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } });
    expect(args.slice(-2, -1)).toEqual(["--request"]);
    const process = child();
    setImmediate(async () => {
      const request = JSON.parse(await readFile(args.at(-1)!, "utf8"));
      expect(request.expectedText).toBe(expectedText);
      expect(request.followingText).toBe(followingText);
      await writeFile(request.outputWav, wav);
      await writeFile(request.outputJson, JSON.stringify(response));
      process.emit("close", 0);
    });
    return process;
  });
}

afterEach(() => vi.unstubAllEnvs());

const endpointExpected = "来~~，面来啦！慢点儿吃，小心烫。汤也喝一点，暖胃。";
const endpointPrefix = "来面来了慢点吃小心烫汤也喝一点暖胃";
const endpointFollowing = "今天外面风大。";
const endpointEvidence = {
  stage: "source_alignment", expectedText: endpointExpected, followingText: endpointFollowing,
  sourceTranscript: `${endpointPrefix}今天外面风大`,
  sourceWords: Array.from(`${endpointPrefix}今天外面风大`).map((text, index) => ({ text, start: index * .03, end: (index + 1) * .03 })),
  endpointCandidates: [{ terminalWordIndex: 16, recognizedPrefix: endpointPrefix, similarity: .888889 }],
};
const endpointComparison = { mode: "bounded_edits", status: "different", similarity: .888889, threshold: .85,
  expected: "来面来啦慢点儿吃小心烫汤也喝一点暖胃", recognized: endpointPrefix,
  substitutionCount: 1, insertionCount: 0, deletionCount: 1, editCount: 2 };
const endpointMatch = { method: "ending_anchor", terminalWordIndex: 16, anchorText: "暖胃", recognizedPrefix: endpointPrefix };
const endpointCut = { method: "two_sided", thresholdDbfs: -68, quietStartSeconds: .8, quietEndSeconds: 1.2 };
const endpointSuccess = { ...validResult, transcript: endpointPrefix, coverage: .888889, cutValidation: endpointCut,
  recognition: { ...endpointEvidence, stage: "complete", targetTranscript: endpointPrefix, contentComparison: endpointComparison, boundaryMatch: endpointMatch } };
const endpointFailure = { version: 1, success: false, code: "uncertain_word_alignment", recognition: endpointEvidence };
const endpointApiEnv = { ASMR_PLANNER_API_URL: "https://example.test/v1", ASMR_PLANNER_API_MODEL: "fixture-model", ASMR_PLANNER_API_KEY: "fixture-only" };
const endpointApiResponse = (terminalWordIndex: number | null) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ terminalWordIndex }) } }] }));

function sequenceSpawn(wav: Uint8Array, responses: unknown[]) {
  const requests: Record<string, unknown>[] = [];
  const spawnImpl: VoiceAnalysisSpawn = vi.fn((_command, args) => {
    const process = child();
    setImmediate(async () => {
      const request = JSON.parse(await readFile(args.at(-1)!, "utf8"));
      const response = responses[requests.length];
      requests.push(request);
      await writeFile(request.outputWav, wav);
      await writeFile(request.outputJson, JSON.stringify(response));
      process.emit("close", 0);
    });
    return process;
  });
  return { spawnImpl, requests };
}

describe("local voice-group verification", () => {
  it("shares the initial readiness probe with analysis after the global cache lifetime and registers cleanup once", async () => {
    const { input, readinessImpl } = await fixture();
    const readiness = vi.fn(readinessImpl);
    await withVoxCpm2RuntimeSession(input.config, undefined, async (session) => {
      const onClose = vi.fn(session.onClose!);
      const runtimeSession = { ...session, onClose };
      const dependencies = { runtimeSession, readinessImpl: readiness };
      await expect(getVoiceAnalysisReadiness(input.config, dependencies)).resolves.toEqual({ available: true });
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
      try {
        await expect(analyzeVoiceGroup(input, { ...dependencies, spawnImpl: successfulSpawn(input.wav) })).resolves.toHaveProperty("wav");
        await expect(getVoiceAnalysisReadiness(input.config, dependencies)).resolves.toEqual({ available: true });
        expect(readiness).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
      } finally { clock.mockRestore(); }
    });
    await withVoxCpm2RuntimeSession(input.config, undefined, async (runtimeSession) => {
      await expect(getVoiceAnalysisReadiness(input.config, { runtimeSession, readinessImpl: readiness })).resolves.toEqual({ available: true });
    });
    expect(readiness).toHaveBeenCalledTimes(2);
  });

  it("retains an unavailable probe within its session without repeatedly importing a broken environment", async () => {
    const { input } = await fixture();
    const readiness = vi.fn().mockRejectedValue(new VoiceGroupAnalysisError("Unavailable fixture environment", 503));
    const spawnImpl = vi.fn();
    await withVoxCpm2RuntimeSession(input.config, undefined, async (runtimeSession) => {
      const dependencies = { runtimeSession, readinessImpl: readiness };
      await expect(getVoiceAnalysisReadiness(input.config, dependencies)).resolves.toMatchObject({ available: false });
      await expect(analyzeVoiceGroup(input, { ...dependencies, spawnImpl })).rejects.toMatchObject({ statusCode: 503 });
      expect(readiness).toHaveBeenCalledOnce();
      expect(spawnImpl).not.toHaveBeenCalled();
    });
  });

  it("keeps one worker and readiness check across groups, including a rejected transcript", async () => {
    vi.stubEnv("ASMR_VOICE_ASR_REUSE", "always");
    const { input, runtimeRoot, readinessImpl } = await fixture();
    const readiness = vi.fn(readinessImpl);
    let requests = 0;
    const process = Object.assign(child(), { stdin: new PassThrough(), stdout: new PassThrough() });
    process.stdin.on("end", () => process.emit("close", 0));
    process.stdin.on("data", async (chunk: Buffer) => {
      const { requestPath } = JSON.parse(chunk.toString());
      const request = JSON.parse(await readFile(requestPath, "utf8"));
      requests++;
      await writeFile(request.outputWav, input.wav);
      await writeFile(request.outputJson, JSON.stringify(requests === 1
        ? { version: 1, success: false, code: "cut_text_mismatch", recognition } : validResult));
      process.stdout.write(JSON.stringify({ requestPath, code: 0 }) + "\n");
    });
    const workerSpawnImpl = vi.fn(() => process);
    await withVoxCpm2RuntimeSession(input.config, undefined, async (runtimeSession) => {
      const dependencies = { runtimeSession, readinessImpl: readiness, workerSpawnImpl };
      await expect(analyzeVoiceGroup(input, dependencies)).rejects.toMatchObject({ diagnosticCode: "cut_text_mismatch", recognition });
      await expect(analyzeVoiceGroup(input, dependencies)).resolves.toMatchObject({ wav: input.wav });
      expect(workerSpawnImpl).toHaveBeenCalledOnce();
      expect(readiness).toHaveBeenCalledOnce();
      expect(process.kill).not.toHaveBeenCalled();
    });
    expect(requests).toBe(2);
    expect(await readdir(path.join(runtimeRoot, "voxcpm2-product", "analysis-runs"))).toEqual([]);
    expect(await readdir(path.join(runtimeRoot, "locks"))).toEqual([]);
  });
  it("reuses a resident model automatically only with enough spare physical memory", () => {
    expect(shouldReuseVoiceAnalysis(5 * 1024 ** 3, "auto")).toBe(false);
    expect(shouldReuseVoiceAnalysis(8 * 1024 ** 3, "auto")).toBe(true);
    expect(shouldReuseVoiceAnalysis(32 * 1024 ** 3, "off")).toBe(false);
    expect(shouldReuseVoiceAnalysis(2 * 1024 ** 3, "always")).toBe(true);
  });
  it("uses an offline hidden process and validates/copies the result before removing the temporary directory", async () => {
    const { input, runtimeRoot, readinessImpl } = await fixture();
    const result = await analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav) });
    expect(result).toEqual({ ...validResult, wav: input.wav, version: undefined, success: undefined });
    expect(JSON.stringify(result)).not.toContain(runtimeRoot);
    expect(await readdir(path.join(runtimeRoot, "voxcpm2-product", "analysis-runs"))).toEqual([]);
  });

  it("rejects ASR failure or a fabricated crop duration instead of returning a candidate", async () => {
    const { input, readinessImpl } = await fixture();
    for (const response of [
      { version: 1, success: false, code: "no_safe_quiet_cut" },
      { ...validResult, cutEndSeconds: .7 },
      { ...validResult, coverage: .8 },
      { ...validResult, privateModelPath: "D:/private-model" },
      { ...validResult, leadingQuietMs: 1000 },
    ]) {
      await expect(analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav, response) })).rejects.toMatchObject({ statusCode: 422 });
    }
  });

  it("retains bounded quiet-validation metadata for server assembly evidence", async () => {
    const { input, readinessImpl } = await fixture();
    const source = writePcm16MonoWav(new Float32Array(96_000).fill(.05), 48_000);
    const cutValidation = { method: "noise_adapted", thresholdDbfs: -61.5, quietStartSeconds: .8, quietEndSeconds: 1.2 };
    const result = await analyzeVoiceGroup({ ...input, wav: source }, {
      readinessImpl, spawnImpl: successfulSpawn(input.wav, { ...validResult, trailingQuietMs: 200, cutValidation }),
    });
    expect(result.cutValidation).toEqual(cutValidation);
    expect(result.trailingQuietMs).toBe(200);
  });

  it("rejects unsafe adaptation thresholds, insufficient quiet guards and out-of-source evidence", async () => {
    const { input, readinessImpl } = await fixture();
    const base = { method: "noise_adapted", thresholdDbfs: -61.5, quietStartSeconds: .7, quietEndSeconds: .95 };
    for (const cutValidation of [
      { ...base, thresholdDbfs: -55 },
      { ...base, quietEndSeconds: .8 },
      { ...base, quietStartSeconds: 1.1, quietEndSeconds: 1.4 },
      { ...base, method: "manual_override" },
      { ...base, localPath: "D:/private" },
    ]) {
      await expect(analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav, { ...validResult, cutValidation }) })).rejects.toMatchObject({ statusCode: 422 });
    }
  });

  it("retains a bounded diagnostic code for server traces without exposing it as the user message", async () => {
    const { input, readinessImpl } = await fixture();
    await expect(analyzeVoiceGroup(input, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, { version: 1, success: false, code: "no_safe_quiet_cut" }),
    })).rejects.toMatchObject({ statusCode: 422, diagnosticCode: "no_safe_quiet_cut", message: "未能确认这组台词完整且截取安全，请重新生成。" });
  });

  it("retains complete recognition on success and on a later invalid crop without accepting the crop", async () => {
    const { input, readinessImpl } = await fixture();
    const evidence = { stage: "complete", sourceTranscript: recognition.sourceTranscript, sourceWords: recognition.sourceWords,
      expectedText: recognition.expectedText, targetTranscript: "慢慢放松。" };
    const result = await analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav, { ...validResult, recognition: evidence }) });
    expect(result.recognition).toEqual(evidence);
    await expect(analyzeVoiceGroup(input, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, { ...validResult, recognition: evidence, cutEndSeconds: .7 }),
    })).rejects.toMatchObject({ statusCode: 422, recognition: evidence });
  });

  it("returns safely cropped audio with an explicit bounded text difference without weakening coverage", async () => {
    const { input, readinessImpl } = await fixture();
    const expectedText = "回来啦？外面是不是很冷？";
    const evidence = { stage: "complete", sourceTranscript: "回来了，外面是不是很冷？", expectedText,
      targetTranscript: "回来了，外面是不是很冷？", contentComparison: { status: "different", similarity: .9,
        threshold: .9, substitutionCount: 1, expected: "回来啦外面是不是很冷", recognized: "回来了外面是不是很冷" } };
    const request = { ...input, expectedText, clauses: [expectedText] };
    const response = { ...validResult, transcript: evidence.targetTranscript, coverage: .9, recognition: evidence };
    const result = await analyzeVoiceGroup(request, { readinessImpl, spawnImpl: successfulSpawn(input.wav, response, expectedText) });
    expect(result).toMatchObject({ wav: input.wav, coverage: .9, recognition: evidence });
    for (const invalid of [
      { ...response, coverage: .89 },
      { ...response, recognition: { ...evidence, contentComparison: { ...evidence.contentComparison, status: "matched" } } },
      { ...response, cutEndSeconds: .7 },
    ]) await expect(analyzeVoiceGroup(request, { readinessImpl, spawnImpl: successfulSpawn(input.wav, invalid, expectedText) })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("requires two-sided quiet-cut evidence for different text followed by continuation", async () => {
    const { input, readinessImpl } = await fixture();
    const expectedText = "回来啦？外面是不是很冷？", followingText = "快进来。";
    const source = writePcm16MonoWav(new Float32Array(96_000).fill(.05), 48_000);
    const evidence = { stage: "complete", sourceTranscript: "回来了，外面是不是很冷？快进来。", expectedText, followingText,
      targetTranscript: "回来了，外面是不是很冷？", contentComparison: { status: "different", similarity: .9,
        threshold: .9, substitutionCount: 1, expected: "回来啦外面是不是很冷", recognized: "回来了外面是不是很冷" } };
    const request = { ...input, wav: source, expectedText, followingText, clauses: [expectedText] };
    const response = { ...validResult, transcript: evidence.targetTranscript, coverage: .9, recognition: evidence };
    await expect(analyzeVoiceGroup(request, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, response, expectedText, followingText),
    })).rejects.toMatchObject({ statusCode: 422, recognition: evidence });
    const cutValidation = { method: "two_sided", thresholdDbfs: -68, quietStartSeconds: .8, quietEndSeconds: 1.2 };
    const accepted = await analyzeVoiceGroup(request, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, { ...response, cutValidation }, expectedText, followingText) });
    expect(accepted).toMatchObject({ wav: input.wav, recognition: evidence, cutValidation });
  });

  it("allows bounded edits below 90 percent only with matched target, endpoint and two-sided audio proof", async () => {
    const { input, readinessImpl } = await fixture();
    const source = writePcm16MonoWav(new Float32Array(96_000).fill(.05), 48_000);
    const request = { ...input, wav: source, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] };
    for (const method of ["two_sided", "noise_adapted"]) {
      await expect(analyzeVoiceGroup(request, { readinessImpl,
        spawnImpl: successfulSpawn(input.wav, { ...endpointSuccess, cutValidation: { ...endpointCut, method } }, endpointExpected, endpointFollowing),
      })).resolves.toMatchObject({ coverage: .888889, cutValidation: { method }, recognition: { contentComparison: endpointComparison, boundaryMatch: endpointMatch } });
    }
    for (const response of [
      { ...endpointSuccess, cutValidation: undefined },
      { ...endpointSuccess, cutValidation: { ...endpointCut, method: "noise_adapted", thresholdDbfs: -59 } },
      { ...endpointSuccess, recognition: { ...endpointSuccess.recognition, boundaryMatch: undefined } },
      { ...endpointSuccess, recognition: { ...endpointSuccess.recognition, contentComparison: undefined } },
      { ...endpointSuccess, recognition: { ...endpointSuccess.recognition, expectedText: "别的台词。" } },
      { ...endpointSuccess, coverage: .85 },
    ]) await expect(analyzeVoiceGroup(request, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, response, endpointExpected, endpointFollowing),
    })).rejects.toMatchObject({ statusCode: 422 });
    await expect(analyzeVoiceGroup({ ...request, followingText: undefined }, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, { ...endpointSuccess, recognition: { ...endpointSuccess.recognition, followingText: "" } }, endpointExpected),
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("also requires endpoint proof for bounded edits whose similarity exceeds the legacy threshold", async () => {
    const { input, readinessImpl } = await fixture();
    const expectedText = "来面来啦慢点吃小心烫汤也喝一点暖胃";
    const comparison = { ...endpointComparison, expected: expectedText, deletionCount: 0, editCount: 1, similarity: .941176 };
    const evidence = { ...endpointSuccess.recognition, expectedText, contentComparison: comparison, boundaryMatch: undefined };
    await expect(analyzeVoiceGroup({ ...input, expectedText, followingText: endpointFollowing, clauses: [expectedText] }, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, { ...endpointSuccess, coverage: comparison.similarity, cutValidation: undefined, recognition: evidence }, expectedText, endpointFollowing),
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("uses one API index selection and independently verifies one server-only hint without regenerating voice", async () => {
    const { input, readinessImpl } = await fixture();
    const source = writePcm16MonoWav(new Float32Array(96_000).fill(.05), 48_000);
    const accepted = { ...endpointSuccess, recognition: { ...endpointSuccess.recognition, boundaryMatch: { ...endpointMatch, method: "api" } } };
    const { spawnImpl, requests } = sequenceSpawn(input.wav, [endpointFailure, accepted]);
    const fetchImpl = vi.fn().mockResolvedValue(endpointApiResponse(16));
    await expect(analyzeVoiceGroup({ ...input, wav: source, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] }, {
      readinessImpl, spawnImpl, env: endpointApiEnv, fetchImpl,
    })).resolves.toMatchObject({ wav: input.wav, recognition: { boundaryMatch: { method: "api", terminalWordIndex: 16 },
      apiFallback: { status: "selected", model: "fixture-model" } } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(requests[0]).not.toHaveProperty("alignmentHint");
    expect(requests[1].alignmentHint).toEqual({ terminalWordIndex: 16, recognizedPrefix: endpointPrefix });
  });

  it("accepts locally verified noise-adapted quiet after API endpoint selection", async () => {
    const { input, readinessImpl } = await fixture();
    const source = writePcm16MonoWav(new Float32Array(96_000).fill(.05), 48_000);
    const cutValidation = { ...endpointCut, method: "noise_adapted", thresholdDbfs: -61.5 };
    const accepted = { ...endpointSuccess, cutValidation,
      recognition: { ...endpointSuccess.recognition, boundaryMatch: { ...endpointMatch, method: "api" } } };
    const { spawnImpl } = sequenceSpawn(input.wav, [endpointFailure, accepted]);
    const fetchImpl = vi.fn().mockResolvedValue(endpointApiResponse(16));
    await expect(analyzeVoiceGroup({ ...input, wav: source, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] }, {
      readinessImpl, spawnImpl, env: endpointApiEnv, fetchImpl,
    })).resolves.toMatchObject({ coverage: .888889, cutValidation, recognition: { boundaryMatch: { method: "api", terminalWordIndex: 16 } } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps original recognition on API decline and unavailable responses without another local pass", async () => {
    const { input, readinessImpl } = await fixture();
    for (const [response, status] of [[endpointApiResponse(null), "declined"], [new Response("unavailable", { status: 503 }), "unavailable"]] as const) {
      const { spawnImpl } = sequenceSpawn(input.wav, [endpointFailure]);
      const fetchImpl = vi.fn().mockResolvedValue(response);
      await expect(analyzeVoiceGroup({ ...input, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] }, {
        readinessImpl, spawnImpl, env: endpointApiEnv, fetchImpl,
      })).rejects.toMatchObject({ statusCode: 422, diagnosticCode: "uncertain_word_alignment", recognition: {
        ...endpointEvidence, apiFallback: { status, model: "fixture-model" },
      } });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(spawnImpl).toHaveBeenCalledOnce();
    }
  });

  it("rejects a second-pass result that does not confirm the selected API endpoint", async () => {
    const { input, readinessImpl } = await fixture();
    const source = writePcm16MonoWav(new Float32Array(96_000).fill(.05), 48_000);
    for (const boundaryMatch of [endpointMatch, { ...endpointMatch, method: "api", terminalWordIndex: 15 },
      { ...endpointMatch, method: "api", recognizedPrefix: `${endpointPrefix}天` }]) {
      const { spawnImpl } = sequenceSpawn(input.wav, [endpointFailure,
        { ...endpointSuccess, recognition: { ...endpointSuccess.recognition, boundaryMatch } }]);
      const fetchImpl = vi.fn().mockResolvedValue(endpointApiResponse(16));
      await expect(analyzeVoiceGroup({ ...input, wav: source, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] }, {
        readinessImpl, spawnImpl, env: endpointApiEnv, fetchImpl,
      })).rejects.toMatchObject({ statusCode: 422 });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("accepts an independently exact crop after API endpoint selection while still requiring its two-sided proof", async () => {
    const { input, readinessImpl } = await fixture();
    const source = writePcm16MonoWav(new Float32Array(96_000).fill(.05), 48_000);
    const expected = endpointComparison.expected;
    const complete = { ...endpointSuccess, coverage: 1, transcript: expected, recognition: { ...endpointSuccess.recognition,
      targetTranscript: expected, boundaryMatch: { ...endpointMatch, method: "api" },
      contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected, recognized: expected } } };
    for (const cutValidation of [endpointCut, undefined]) {
      const { spawnImpl } = sequenceSpawn(input.wav, [endpointFailure, { ...complete, cutValidation }]);
      const pending = analyzeVoiceGroup({ ...input, wav: source, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] }, {
        readinessImpl, spawnImpl, env: endpointApiEnv, fetchImpl: vi.fn().mockResolvedValue(endpointApiResponse(16)),
      });
      if (cutValidation) await expect(pending).resolves.toMatchObject({ coverage: 1, recognition: { boundaryMatch: { method: "api" } } });
      else await expect(pending).rejects.toMatchObject({ statusCode: 422 });
    }
  });

  it("does not loop API decisions when independent local verification still fails", async () => {
    const { input, readinessImpl } = await fixture();
    const { spawnImpl } = sequenceSpawn(input.wav, [endpointFailure, endpointFailure]);
    const fetchImpl = vi.fn().mockResolvedValue(endpointApiResponse(16));
    await expect(analyzeVoiceGroup({ ...input, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] }, {
      readinessImpl, spawnImpl, env: endpointApiEnv, fetchImpl,
    })).rejects.toMatchObject({ statusCode: 422, diagnosticCode: "uncertain_word_alignment", recognition: endpointEvidence });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("retains complete first-pass evidence when the API verification pass fails before producing recognition", async () => {
    const { input, readinessImpl } = await fixture();
    const emptyRecognition = { stage: "source_transcription", expectedText: endpointExpected, followingText: endpointFollowing, sourceTranscript: "" };
    const { spawnImpl } = sequenceSpawn(input.wav, [endpointFailure,
      { version: 1, success: false, code: "analysis_failed", recognition: emptyRecognition }]);
    const fetchImpl = vi.fn().mockResolvedValue(endpointApiResponse(16));
    await expect(analyzeVoiceGroup({ ...input, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] }, {
      readinessImpl, spawnImpl, env: endpointApiEnv, fetchImpl,
    })).rejects.toMatchObject({ statusCode: 503, diagnosticCode: "analysis_failed", recognition: {
      ...endpointEvidence, apiFallback: { status: "selected", model: "fixture-model" },
    } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("retains first-pass ASR when cancelled during the empty checkpoint of API verification", async () => {
    const { input, readinessImpl } = await fixture();
    const controller = new AbortController();
    let launched = 0;
    const spawnImpl: VoiceAnalysisSpawn = vi.fn((_command, args) => {
      const process = child();
      const secondPass = ++launched === 2;
      setImmediate(async () => {
        const request = JSON.parse(await readFile(args.at(-1)!, "utf8"));
        await writeFile(request.outputJson, JSON.stringify(secondPass ? {
          version: 1, success: false, code: "analysis_incomplete",
          recognition: { stage: "source_transcription", expectedText: endpointExpected, followingText: endpointFollowing, sourceTranscript: "" },
        } : endpointFailure));
        if (secondPass) controller.abort();
        else process.emit("close", 0);
      });
      return process;
    });
    const fetchImpl = vi.fn().mockResolvedValue(endpointApiResponse(16));
    await expect(analyzeVoiceGroup({ ...input, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected], signal: controller.signal }, {
      readinessImpl, spawnImpl, env: endpointApiEnv, fetchImpl,
    })).rejects.toMatchObject({ statusCode: 499, recognition: {
      ...endpointEvidence, apiFallback: { status: "selected", model: "fixture-model" },
    } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it("skips the API for audio-boundary failures and preserves recognition when cancelled during selection", async () => {
    const { input, readinessImpl } = await fixture();
    const request = { ...input, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected] };
    const fetchImpl = vi.fn();
    await expect(analyzeVoiceGroup(request, { readinessImpl, env: endpointApiEnv, fetchImpl,
      spawnImpl: successfulSpawn(input.wav, { ...endpointFailure, code: "no_verified_quiet_cut" }, endpointExpected, endpointFollowing),
    })).rejects.toMatchObject({ statusCode: 422 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const controller = new AbortController();
    const cancelFetch = vi.fn(async () => { controller.abort(); return endpointApiResponse(16); });
    const { spawnImpl } = sequenceSpawn(input.wav, [endpointFailure]);
    await expect(analyzeVoiceGroup({ ...request, signal: controller.signal }, { readinessImpl, env: endpointApiEnv, fetchImpl: cancelFetch, spawnImpl }))
      .rejects.toMatchObject({ statusCode: 499, recognition: endpointEvidence });
    expect(spawnImpl).toHaveBeenCalledOnce();
  });

  it.each(["isolated", "worker"])("recovers checkpointed source recognition after an %s process timeout", async (mode) => {
    vi.stubEnv("ASMR_VOICE_ASR_REUSE", "always");
    const { input, readinessImpl } = await fixture();
    const process = Object.assign(child(), { stdin: new PassThrough(), stdout: new PassThrough() });
    const checkpoint = async (requestPath: string) => {
      const request = JSON.parse(await readFile(requestPath, "utf8"));
      await writeFile(request.outputJson, JSON.stringify({ version: 1, success: false, code: "analysis_incomplete", recognition }));
    };
    process.stdin.on("data", async (chunk: Buffer) => { await checkpoint(JSON.parse(chunk.toString()).requestPath); });
    const spawnImpl: VoiceAnalysisSpawn = (_command, args) => { void checkpoint(args.at(-1)!); return process; };
    await withVoxCpm2RuntimeSession(input.config, undefined, async (runtimeSession) => {
      await expect(analyzeVoiceGroup(input, { readinessImpl, runtimeSession, timeoutMs: 60,
        ...(mode === "worker" ? { workerSpawnImpl: () => process } : { spawnImpl }),
      })).rejects.toMatchObject({ statusCode: 504, recognition });
    });
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("preserves a first-pass recognition checkpoint when cancellation happens before optional API selection", async () => {
    const { input, readinessImpl } = await fixture();
    const controller = new AbortController();
    const fetchImpl = vi.fn();
    const spawnImpl: VoiceAnalysisSpawn = (_command, args) => {
      const process = child();
      setImmediate(async () => {
        const request = JSON.parse(await readFile(args.at(-1)!, "utf8"));
        await writeFile(request.outputJson, JSON.stringify({ version: 1, success: false, code: "analysis_incomplete", recognition }));
        controller.abort();
      });
      return process;
    };
    await expect(analyzeVoiceGroup({ ...input, signal: controller.signal }, { readinessImpl, spawnImpl, fetchImpl, env: endpointApiEnv }))
      .rejects.toMatchObject({ statusCode: 499, recognition });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("discards malformed or unrelated recognition while retaining the safe failure", async () => {
    const { input, readinessImpl, runtimeRoot } = await fixture();
    for (const evidence of [
      { ...recognition, privateModelPath: runtimeRoot },
      { ...recognition, expectedText: "别的目标。" },
      { ...recognition, sourceWords: [{ text: "坏时间", start: 2, end: 1 }] },
    ]) {
      try {
        await analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav,
          { version: 1, success: false, code: "uncertain_word_alignment", recognition: evidence }) });
        throw new Error("Expected rejected recognition");
      } catch (error) {
        expect(error).toBeInstanceOf(VoiceGroupAnalysisError);
        expect((error as VoiceGroupAnalysisError).recognition?.sourceTranscript).toBe("");
        expect(JSON.stringify(error)).not.toContain(runtimeRoot);
      }
    }
  });

  it("classifies model execution faults as unavailable so they cannot trigger more TTS retries", async () => {
    const { input, readinessImpl } = await fixture();
    await expect(analyzeVoiceGroup(input, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, { version: 1, success: false, code: "analysis_failed" }),
    })).rejects.toMatchObject({ statusCode: 503, diagnosticCode: "analysis_failed" });
  });

  it("rejects invalid audio and pre-cancelled work before launching any process", async () => {
    const { input, readinessImpl } = await fixture();
    const spawnImpl = vi.fn();
    await expect(analyzeVoiceGroup({ ...input, wav: new Uint8Array(8) }, { readinessImpl, spawnImpl })).rejects.toMatchObject({ statusCode: 422 });
    await expect(analyzeVoiceGroup({ ...input, signal: AbortSignal.abort() }, { readinessImpl, spawnImpl })).rejects.toMatchObject({ statusCode: 499 });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("cancellation kills and waits for actual exit before cleaning the working directory", async () => {
    const { input, runtimeRoot, readinessImpl } = await fixture();
    const process = child();
    process.kill.mockImplementation(() => true);
    const controller = new AbortController();
    const runtimeSession = { runtimeRoot, processStarted: vi.fn(), processExited: vi.fn() };
    let started!: () => void;
    const launched = new Promise<void>((resolve) => { started = resolve; });
    const pending = analyzeVoiceGroup({ ...input, signal: controller.signal }, { readinessImpl, runtimeSession, spawnImpl: () => { started(); return process; } });
    const assertion = expect(pending).rejects.toMatchObject({ statusCode: 499 });
    await launched;
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
    expect(runtimeSession.processStarted).toHaveBeenCalledWith(process.pid);
    expect(runtimeSession.processExited).not.toHaveBeenCalled();
    expect(await readdir(path.join(runtimeRoot, "voxcpm2-product", "analysis-runs"))).toHaveLength(1);
    process.emit("close", null);
    await assertion;
    expect(runtimeSession.processExited).toHaveBeenCalledOnce();
    expect(await readdir(path.join(runtimeRoot, "voxcpm2-product", "analysis-runs"))).toEqual([]);
  });

  it("retires a failed spawn without a PID only once while another TTS remains registered", async () => {
    const { input, runtimeRoot, readinessImpl } = await fixture();
    const process = Object.assign(new EventEmitter(), { pid: undefined, kill: vi.fn() });
    await withVoxCpm2RuntimeSession(input.config, undefined, async (runtimeSession) => {
      runtimeSession.processStarted(22);
      try {
        await expect(analyzeVoiceGroup(input, { runtimeSession, readinessImpl, spawnImpl: () => {
          setImmediate(() => { process.emit("error", new Error("spawn unavailable")); process.emit("close", -2); });
          return process;
        } })).rejects.toMatchObject({ statusCode: 503 });
        const lock = JSON.parse(await readFile(path.join(runtimeRoot, "locks", "voxcpm2-generation.lock"), "utf8"));
        expect(lock.childPids).toEqual([22]);
      } finally { await runtimeSession.processExited(22); }
    });
    expect(await readdir(path.join(runtimeRoot, "locks"))).toEqual([]);
  });

  it("a timeout kills the child and returns a safe error", async () => {
    const { input, readinessImpl } = await fixture();
    const process = child();
    await expect(analyzeVoiceGroup(input, { readinessImpl, timeoutMs: 10, spawnImpl: () => process })).rejects.toMatchObject({ statusCode: 504 });
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("retains the working directory when process exit cannot be confirmed", async () => {
    const { input, runtimeRoot, readinessImpl } = await fixture();
    const process = child();
    process.kill.mockImplementation(() => false);
    const runtimeSession = { runtimeRoot, processStarted: vi.fn(), processExited: vi.fn() };
    await expect(analyzeVoiceGroup(input, { readinessImpl, runtimeSession, timeoutMs: 5, exitWaitMs: 5, spawnImpl: () => process })).rejects.toMatchObject({ statusCode: 503 });
    expect(runtimeSession.processExited).not.toHaveBeenCalled();
    expect(await readdir(path.join(runtimeRoot, "voxcpm2-product", "analysis-runs"))).toHaveLength(1);
  });

  it("reports missing local analysis installation without disclosing a server path", async () => {
    const { input, runtimeRoot } = await fixture();
    const status = await getVoiceAnalysisReadiness(input.config);
    expect(status.available).toBe(false);
    expect(JSON.stringify(status)).not.toContain(runtimeRoot);
  });
});
