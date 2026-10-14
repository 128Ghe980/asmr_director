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

function successfulSpawn(wav: Uint8Array, response: unknown = validResult, expectedText = "慢慢放松。", followingText = "", requireTwoSided?: boolean): VoiceAnalysisSpawn {
  return vi.fn((_command, args, options) => {
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: "ignore", env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } });
    expect(args.slice(-2, -1)).toEqual(["--request"]);
    const process = child();
    setImmediate(async () => {
      const request = JSON.parse(await readFile(args.at(-1)!, "utf8"));
      expect(request.expectedText).toBe(expectedText);
      expect(request.followingText).toBe(followingText);
      if (requireTwoSided !== undefined) expect(request.requireTwoSided).toBe(requireTwoSided);
      await writeFile(request.outputWav, wav);
      await writeFile(request.outputJson, JSON.stringify(response));
      process.emit("close", 0);
    });
    return process;
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("paragraph boundary verification contract", () => {
  it("forwards forced two-sided verification and rejects exact-text results without quiet evidence", async () => {
    const f = await fixture();
    await expect(analyzeVoiceGroup({ ...f.input, followingText: "安静休息。", requireTwoSided: true }, {
      readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.input.wav, validResult, f.input.expectedText, "安静休息。", true),
    })).rejects.toMatchObject({ statusCode: 422 });
  });
  it("accepts a forced result only when the existing quiet boundary evidence is present", async () => {
    const f = await fixture();
    const response = { ...validResult, cutValidation: { method: "two_sided", thresholdDbfs: -68, quietStartSeconds: .8, quietEndSeconds: 1 } };
    const result = await analyzeVoiceGroup({ ...f.input, followingText: "安静休息。", requireTwoSided: true }, {
      readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.input.wav, response, f.input.expectedText, "安静休息。", true),
    });
    expect(result.cutValidation).toEqual(response.cutValidation);
  });
});

describe("phonetic results retain independent audio and content guards", () => {
  const expectedText = "来~~，面来啦！汤也喝一点，暖胃。", followingText = "今天是不是又加班了？";
  const contentComparison = { mode: "phonetic_substitutions", status: "different", similarity: .818182, threshold: .9,
    phoneticSimilarity: .954545, phoneticThreshold: .95, substitutionCount: 2,
    expected: "来面来啦汤也喝一点暖胃", recognized: "来面来了糖也喝一点暖胃", sourcePrefix: "来面来了汤也喝一点暖胃",
    differences: [{ index: 3, expected: "啦", recognized: "了", expectedPinyin: "la5", recognizedPinyin: "le5", rule: "sentence_particle", clauseEnd: true },
      { index: 4, expected: "汤", recognized: "糖", expectedPinyin: "tang1", recognizedPinyin: "tang2", rule: "source_supported_tone", sourceCharacter: "汤" }] };
  const evidence = { stage: "complete", expectedText, followingText, targetTranscript: "来,面来了,糖也喝一点,暖胃",
    sourceTranscript: "来,面来了,汤也喝一点,暖胃。今天是不是又加班了？",
    sourceWords: [{ text: "来,面来了,汤也喝一点,暖胃。", start: .05, end: .3 }, { text: followingText, start: .7, end: .95 }], contentComparison };
  const result = { ...validResult, transcript: evidence.targetTranscript, coverage: .818182, cutEndSeconds: .5,
    internalPausesMs: [30, 30, 30], recognition: evidence,
    cutValidation: { method: "two_sided", thresholdDbfs: -90, quietStartSeconds: .35, quietEndSeconds: .65 } };
  const prepare = async () => {
    const f = await fixture();
    const input = { ...f.input, expectedText, followingText, clauses: ["来~~，", "面来啦！", "汤也喝一点，", "暖胃。"] };
    const cropped = writePcm16MonoWav(new Float32Array(24_000).fill(.05), 48_000);
    return { ...f, input, cropped };
  };

  it("accepts bounded pronunciation differences only with matched evidence and a verified quiet cut", async () => {
    const f = await prepare();
    const measured = await analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, result, expectedText, followingText) });
    expect(measured.coverage).toBe(.818182);
    expect(measured.recognition?.contentComparison).toEqual(contentComparison);
    expect(measured.cutValidation).toEqual(result.cutValidation);
  });

  it.each([
    { ...result, cutValidation: undefined },
    { ...result, cutValidation: { ...result.cutValidation, quietEndSeconds: .4 } },
    { ...result, cutValidation: { ...result.cutValidation, quietStartSeconds: .51 } },
    { ...result, recognition: { ...evidence, stage: "target_validation" } },
    { ...result, recognition: { ...evidence, sourceWords: undefined } },
    { ...result, recognition: { ...evidence, followingText: "另一个后文" } },
    { ...result, recognition: { ...evidence, targetTranscript: "无关内容" } },
    { ...result, transcript: "没有真的识别这段" },
    { ...result, coverage: .9 },
  ])("rejects a phonetic score without the corresponding independent proof %#", async invalid => {
    const f = await prepare();
    await expect(analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, invalid, expectedText, followingText) })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("requires particle evidence to match the actual clauses used in this job", async () => {
    const f = await prepare();
    const invalidResult = { ...result, internalPausesMs: [] };
    await expect(analyzeVoiceGroup({ ...f.input, clauses: [expectedText] }, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, invalidResult, expectedText, followingText) })).rejects.toMatchObject({ statusCode: 422 });
  });
});

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

describe("opt-in safe paragraph cuts with unresolved short-sentence text", () => {
  const expectedText = "回来啦。", followingText = "安静休息。";
  const window = (transcript: string) => ({ transcript, words: [{ text: transcript, start: .05, end: .3 }], durationSeconds: .5 });
  const review = { status: "needs_confirmation", reason: "missing_final_particle", expected: "回来啦", sourcePrefix: "回来了",
    expectedPinyin: "la5", sourcePinyin: "le5", similarity: .666667, left: window("回来"), right: window(followingText), final: window("回来") };
  const evidence = { stage: "complete", expectedText, followingText, sourceTranscript: "回来了安静休息", targetTranscript: "回来",
    sourceWords: [{ text: "回来了", start: .05, end: .3 }, { text: followingText, start: .7, end: .95 }], shortSentenceReview: review };
  const response = { ...validResult, transcript: "回来", coverage: .666667, recognition: evidence, cutEndSeconds: .5,
    cutValidation: { method: "two_sided", thresholdDbfs: -90, quietStartSeconds: .35, quietEndSeconds: .65 } };
  const prepare = async () => {
    const f = await fixture();
    return { ...f, input: { ...f.input, expectedText, followingText, clauses: [expectedText],
      requireTwoSided: true, allowShortSentenceParticle: true, allowShortSentenceTextReview: true },
      cropped: writePcm16MonoWav(new Float32Array(24_000).fill(.05), 48_000) };
  };

  it("returns only an explicit review with actual transcripts/coverage and forwards the separate opt-in", async () => {
    const f = await prepare(), sequence = sequenceSpawn(f.cropped, [response]);
    const result = await analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: sequence.spawnImpl });
    expect(result.coverage).toBe(.666667);
    expect(result.transcript).toBe("回来");
    expect(result.recognition?.contentComparison).toBeUndefined();
    expect(result.recognition?.shortSentenceReview).toEqual(review);
    expect(sequence.requests[0]).toMatchObject({ requireTwoSided: true, allowShortSentenceParticle: true, allowShortSentenceTextReview: true });
  });

  it("does not mistake a complete final transcript for an automatic pass when left text still needs confirmation", async () => {
    const f = await prepare();
    const final = window("回来啦。"), complete = { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: "回来啦", recognized: "回来啦" };
    const result = { ...response, transcript: final.transcript, coverage: 1, recognition: { ...evidence, targetTranscript: final.transcript,
      contentComparison: complete, shortSentenceReview: { ...review, final, similarity: 1 } } };
    await expect(analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, result, expectedText, followingText) }))
      .resolves.toMatchObject({ coverage: 1, recognition: { shortSentenceReview: { status: "needs_confirmation" } } });
    await expect(analyzeVoiceGroup({ ...f.input, allowShortSentenceTextReview: false },
      { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, result, expectedText, followingText) })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("allows a reviewed final remainder only with complete original-source evidence", async () => {
    const f = await prepare(), { left: _left, right: _right, ...lastReview } = review;
    void _left; void _right;
    const result = { ...response, cutValidation: undefined, recognition: { ...evidence, followingText: "", sourceTranscript: "回来了",
      sourceWords: evidence.sourceWords.slice(0, 1), shortSentenceReview: lastReview } };
    await expect(analyzeVoiceGroup({ ...f.input, followingText: undefined }, {
      readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, result, expectedText),
    })).resolves.toMatchObject({ coverage: .666667, recognition: { shortSentenceReview: lastReview } });
  });

  it.each([
    { ...response, cutValidation: undefined },
    { ...response, cutValidation: { ...response.cutValidation, quietEndSeconds: .4 } },
    { ...response, coverage: .9 }, { ...response, transcript: "回来啦" },
    { ...response, recognition: { ...evidence, stage: "target_validation" } },
    { ...response, recognition: { ...evidence, shortSentenceReview: { ...review, final: window("回") } } },
    { ...response, recognition: { ...evidence, shortSentenceReview: { ...review, right: window("静休息") } } },
    { ...response, recognition: { ...evidence, shortSentenceReview: { ...review, sourcePrefix: "回来" } } },
    { ...response, recognition: { ...evidence, shortSentenceReview: { ...review, left: undefined } } },
    { ...response, recognition: { ...evidence, shortSentenceReview: { ...review, final: { ...review.final, durationSeconds: .8 } } } },
    { ...response, recognition: { ...evidence, shortSentenceReview: { ...review, left: { ...review.left, durationSeconds: .8 } } } },
    { ...response, recognition: { ...evidence, shortSentenceReview: { ...review, right: { ...review.right, durationSeconds: .8 } } } },
    { ...response, recognition: { ...evidence, sourceWords: [{ text: "回来了", start: .05, end: 1.5 }, evidence.sourceWords[1]] } },
    { ...response, recognition: { ...evidence, sourceWords: [evidence.sourceWords[0], { text: followingText, start: .7, end: 1.5 }] } },
    { ...response, recognition: { ...evidence, contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: "回来", recognized: "回来" } } },
  ])("rejects malformed review evidence and retains the original safety gates %#", async invalid => {
    const f = await prepare();
    await expect(analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, invalid, expectedText, followingText) }))
      .rejects.toMatchObject({ statusCode: 422 });
  });

  it.each([{ requireTwoSided: false }, { allowShortSentenceParticle: false }])("requires both original narrow-scope flags before launching analysis %#", async invalid => {
    const f = await prepare(), spawnImpl = vi.fn();
    await expect(analyzeVoiceGroup({ ...f.input, ...invalid }, { readinessImpl: f.readinessImpl, spawnImpl })).rejects.toMatchObject({ statusCode: 422 });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("cannot use manual text confirmation to enable the semantic API fallback", async () => {
    const f = await fixture(), fetchImpl = vi.fn();
    await expect(analyzeVoiceGroup({ ...f.input, expectedText: endpointExpected, followingText: endpointFollowing, clauses: [endpointExpected],
      requireTwoSided: true, allowShortSentenceParticle: true, allowShortSentenceTextReview: true },
    { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.input.wav, endpointFailure, endpointExpected, endpointFollowing),
      env: endpointApiEnv, fetchImpl })).rejects.toMatchObject({ diagnosticCode: "uncertain_word_alignment" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("single same-tone short text and independent following-boundary evidence", () => {
  const expectedText = "过来坐，炉子边暖和。", expected = "过来坐炉子边暖和", variant = "过来做炉子边暖和";
  const window = (transcript: string) => ({ transcript, words: [{ text: transcript, start: .05, end: .3 }], durationSeconds: .5 });
  const difference = { index: 2, expected: "坐", recognized: "做", expectedPinyin: "zuo4", recognizedPinyin: "zuo4", rule: "same_tone" };
  const prepare = async (text = expectedText, followingText?: string) => {
    const f = await fixture();
    return { ...f, input: { ...f.input, expectedText: text, followingText, clauses: [text], requireTwoSided: true,
      allowShortSentenceParticle: true, allowShortSentenceTextReview: true }, cropped: writePcm16MonoWav(new Float32Array(24_000).fill(.05), 48_000) };
  };
  it.each([[expected, variant], [variant, expected], [variant, variant]])("keeps source %s / final %s differences pending without rewriting verdicts", async (source, final) => {
    const f = await prepare();
    const score = final === expected ? 1 : .875;
    const recognition = { stage: "complete", expectedText, followingText: "", sourceTranscript: source, sourceWords: [{ text: source, start: .05, end: .3 }],
      targetTranscript: final, shortSentenceReview: { status: "needs_confirmation", reason: "same_tone_substitution", expected, sourcePrefix: source,
        similarity: score, differences: [difference], final: window(final) },
      ...(final === expected ? { contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected, recognized: expected } } : {}) };
    const response = { ...validResult, cutEndSeconds: .5, transcript: final, coverage: score, recognition };
    const result = await analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, response, expectedText) });
    expect(result.recognition?.shortSentenceReview?.status).toBe("needs_confirmation");
    expect(result.coverage).toBe(score);
    expect(result.recognition?.shortSentenceReview?.sourcePrefix).toBe(source);
    if (final !== expected) expect(result.recognition?.contentComparison).toBeUndefined();
    await expect(analyzeVoiceGroup({ ...f.input, allowShortSentenceTextReview: false },
      { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, response, expectedText) })).rejects.toMatchObject({ statusCode: 422 });
  });
  const target = "鞋也换了吧，别把寒气带进来。", targetNormalized = "鞋也换了吧别把寒气带进来";
  const recognition = { stage: "complete", expectedText: target, followingText: expectedText, sourceTranscript: target + expected,
    sourceWords: [{ text: target, start: .05, end: .3 }, { text: expected, start: .7, end: .95 }], targetTranscript: target,
    contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: targetNormalized, recognized: targetNormalized },
    followingPhoneticBoundary: { expected, recognized: variant, sourceWordIndex: 1, difference, right: window(variant) } };
  const response = { ...validResult, transcript: target, cutEndSeconds: .5, recognition,
    cutValidation: { method: "two_sided", thresholdDbfs: -90, quietStartSeconds: .35, quietEndSeconds: .65 } };
  it("allows complete same-tone right text only under paragraph opt-in and exact whole original following", async () => {
    const f = await prepare(target, expectedText);
    const result = await analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, response, target, expectedText) });
    expect(result.coverage).toBe(1);
    expect(result.recognition?.followingPhoneticBoundary).toEqual(recognition.followingPhoneticBoundary);
    expect(result.recognition?.shortSentenceReview).toBeUndefined();
    await expect(analyzeVoiceGroup({ ...f.input, allowShortSentenceTextReview: false },
      { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, response, target, expectedText) })).rejects.toMatchObject({ statusCode: 422 });
  });
  it.each([
    { ...response, cutValidation: undefined },
    { ...response, recognition: { ...recognition, followingPhoneticBoundary: { ...recognition.followingPhoneticBoundary,
      difference: { ...difference, recognizedPinyin: "zuo3" } } } },
    { ...response, recognition: { ...recognition, followingPhoneticBoundary: { ...recognition.followingPhoneticBoundary, right: { ...window(variant), durationSeconds: .8 } } } },
    { ...response, recognition: { ...recognition, sourceWords: [recognition.sourceWords[0], { text: expected, start: .7, end: 1.5 }] } },
    { ...response, recognition: { ...recognition, sourceWords: [recognition.sourceWords[0], { text: variant, start: .7, end: .95 }] } },
    { ...response, recognition: { ...recognition, sourceWords: [{ text: target + expected, start: .05, end: .95 }] } },
    { ...response, recognition: { ...recognition, followingPhoneticBoundary: { ...recognition.followingPhoneticBoundary, sourceWordIndex: 2 } } },
  ])("rejects unsupported right differences, missing quiet or false native ranges %#", async invalid => {
    const f = await prepare(target, expectedText);
    await expect(analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, invalid, target, expectedText) })).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("local voice-group verification", () => {
  it("retains a natural clause pause above the join-sampling limit within the recording bound", async () => {
    const { input, readinessImpl } = await fixture();
    const expectedText = "慢慢放松。安静休息。";
    const wav = writePcm16MonoWav(new Float32Array(48_000 * 3).fill(.05), 48_000);
    const request = { ...input, wav, expectedText, clauses: ["慢慢放松。", "安静休息。"] };
    const response = { ...validResult, transcript: "慢慢放松安静休息", internalPausesMs: [1480], cutEndSeconds: 3 };
    await expect(analyzeVoiceGroup(request, { readinessImpl,
      spawnImpl: successfulSpawn(wav, response, expectedText) })).resolves.toMatchObject({
      internalPausesMs: [1480], wav,
    });
    await expect(analyzeVoiceGroup(request, { readinessImpl,
      spawnImpl: successfulSpawn(wav, { ...response, internalPausesMs: [10_001] }, expectedText) })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("requires quiet proof before the interjection for a verified continuation bridge", async () => {
    const { input, readinessImpl } = await fixture();
    const expectedText = "今天是不是又加班了？眼睛都红红的。", followingText = "面快好了，";
    const normalized = "今天是不是又加班了眼睛都红红的";
    const evidence = { stage: "complete", expectedText, followingText,
      sourceTranscript: normalized + "嗯面快好了", targetTranscript: normalized,
      sourceWords: [{ text: normalized, start: .1, end: .6 }, { text: "嗯", start: 1.3, end: 1.5 },
        { text: "面快好了", start: 1.8, end: 2.4 }],
      contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected: normalized, recognized: normalized },
      continuationBridge: { kind: "leading_hmm", text: "嗯", sourceWordIndex: 1,
        sourceStartSeconds: 1.3, sourceEndSeconds: 1.5, rightTranscript: "嗯，面快好了。" } };
    const source = writePcm16MonoWav(new Float32Array(48_000 * 3).fill(.05), 48_000);
    const request = { ...input, wav: source, expectedText, followingText, clauses: [expectedText] };
    const response = { ...validResult, transcript: normalized, recognition: evidence,
      cutValidation: { method: "two_sided", thresholdDbfs: -68, quietStartSeconds: .8, quietEndSeconds: 1.2 } };
    await expect(analyzeVoiceGroup(request, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, response, expectedText, followingText) })).resolves.toMatchObject({ recognition: evidence });
    for (const invalid of [
      { ...response, cutValidation: undefined },
      { ...response, cutValidation: { ...response.cutValidation, quietEndSeconds: 1.4 } },
      { ...response, cutEndSeconds: 1.3 },
      { ...response, recognition: { ...evidence, followingText: "完全不同的后文" } },
    ]) await expect(analyzeVoiceGroup(request, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, invalid, expectedText, followingText) })).rejects.toMatchObject({ statusCode: 422 });
  });

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
  it("accepts the real 2/3 literal score only with opted-in, complete short final-particle and quiet-cut evidence", async () => {
    const { input, readinessImpl } = await fixture();
    const expectedText = "回来啦。", followingText = "先坐下来喝茶。";
    const comparison = { mode: "sentence_particle", status: "different", similarity: .666667, threshold: .9, substitutionCount: 1,
      expected: "回来啦", recognized: "回来了", sourcePrefix: "回来了", acceptanceRule: "exact_prefix_final_particle",
      differences: [{ index: 2, expected: "啦", recognized: "了", expectedPinyin: "la5", recognizedPinyin: "le5", rule: "sentence_particle", clauseEnd: true }] };
    const evidence = { stage: "complete", expectedText, followingText, sourceTranscript: "回来了先坐下来喝茶",
      sourceWords: [{ text: "回来", start: .1, end: .4 }, { text: "了", start: .4, end: .6 }, { text: "先坐下来喝茶", start: 1.2, end: 1.8 }],
      targetTranscript: "回来了", contentComparison: comparison };
    const cutValidation = { method: "two_sided", thresholdDbfs: -60, quietStartSeconds: .9, quietEndSeconds: 1.1 };
    const response = { ...validResult, transcript: "回来了", coverage: .666667, recognition: evidence, cutValidation };
    const source = writePcm16MonoWav(new Float32Array(96_000), 48_000);
    const request = { ...input, wav: source, expectedText, followingText, clauses: [expectedText], requireTwoSided: true, allowShortSentenceParticle: true };
    await expect(analyzeVoiceGroup(request, { readinessImpl, spawnImpl: successfulSpawn(input.wav, response, expectedText, followingText) }))
      .resolves.toMatchObject({ coverage: .666667, recognition: { contentComparison: { mode: "sentence_particle", similarity: .666667 } } });
    for (const invalid of [
      { ...request, allowShortSentenceParticle: false },
      { ...request, requireTwoSided: false },
    ]) await expect(analyzeVoiceGroup(invalid, { readinessImpl, spawnImpl: successfulSpawn(input.wav, response, expectedText, followingText) })).rejects.toMatchObject({ statusCode: 422 });
    for (const invalid of [
      { ...response, coverage: .75 }, { ...response, cutValidation: undefined },
      { ...response, recognition: { ...evidence, sourceWords: undefined } },
      { ...response, recognition: { ...evidence, contentComparison: { ...comparison, sourcePrefix: "回来吧" } } },
    ]) await expect(analyzeVoiceGroup(request, { readinessImpl, spawnImpl: successfulSpawn(input.wav, invalid, expectedText, followingText) })).rejects.toMatchObject({ statusCode: 422 });
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
