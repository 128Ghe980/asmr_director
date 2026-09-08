import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveClipAssetPath, saveClipAsset } from "./local-asset-store";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";
import { VoiceGroupAnalysisError, type VoiceGroupAnalysis } from "./voice-group-analysis";
import { assembleVoiceGroups, generateVoiceLongText } from "./voice-longtext-generation";
import { buildLongTextInputs, type VoiceLongTextPlan } from "./voice-longtext-plan";
import { VoxCpm2Error } from "./voxcpm2-provider";

type Dependencies = NonNullable<Parameters<typeof generateVoiceLongText>[1]>;
type GenerationInput = Parameters<typeof generateVoiceLongText>[0];
const temporaryRoots: string[] = [];
const sampleRate = 48_000;

// Two distinct word-shaped bursts separated by quiet; no real engine or ASR.
function groupWave({ amplitude = .15, leadingMs = 10, pauseMs = 300, trailingMs = 10 } = {}) {
  const burst = Float32Array.from([1, -.6, .3, -.9, .5, -.2, .8, -.4].flatMap((value) => Array(12).fill(value * amplitude)));
  const samples = new Float32Array((leadingMs + pauseMs + trailingMs) * 48 + burst.length * 2);
  samples.set(burst, leadingMs * 48);
  samples.set(burst, leadingMs * 48 + burst.length + pauseMs * 48);
  return writePcm16Wav(samples, sampleRate);
}

function analysis(wav: Uint8Array, text: string, pauseMs = 300, leadingQuietMs = 10, trailingQuietMs = 10): VoiceGroupAnalysis {
  return {
    wav, transcript: text, coverage: 1, internalPausesMs: [pauseMs], leadingQuietMs, trailingQuietMs,
    cutStartSeconds: 0, cutEndSeconds: decodePcmWav(wav).samples.length / sampleRate,
    asrModel: "faster-whisper-large-v3/cpu/int8",
  };
}

function makePlan(): VoiceLongTextPlan {
  const clauses = ["欢迎你。", "慢慢坐下。", "闭上眼睛。", "放松肩膀。", "听着雨声。", "安心休息。"];
  return {
    clauses, groups: [0, 1, 2].map((index) => ({ start: index * 2, end: index * 2 + 1,
      text: clauses.slice(index * 2, index * 2 + 2).join(""), pauseAfter: index === 2 ? "long" : "medium" })),
    clausePauseClasses: ["medium", "medium", "medium", "medium", "medium"], provider: "rules", warnings: [],
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "voice-longtext-test-"));
  temporaryRoots.push(root);
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root });
  const plan = makePlan();
  const targets = buildLongTextInputs(plan);
  const waves = [300, 350, 400].map((pauseMs, index) => groupWave({ pauseMs, amplitude: [.2, .05, .1][index] }));
  const input: GenerationInput = { text: plan.clauses.join(""), clipId: "voice_test", voicePackId: "soft_zh",
    referenceMode: "with_reference_text", analysisProvider: "local", config };
  const deps = {
    readiness: vi.fn<NonNullable<Dependencies["readiness"]>>().mockResolvedValue({ available: true }),
    plan: vi.fn<NonNullable<Dependencies["plan"]>>().mockResolvedValue(plan),
    generate: vi.fn<NonNullable<Dependencies["generate"]>>(async ({ text }) => {
      const index = targets.findIndex((target) => target.text === text);
      if (index < 0) throw new Error("Unexpected target text");
      return { wav: waves[index], provenance: { ...makeVoiceCandidateFixture().provenance, seed: 100 + index }, qualityWarnings: [] };
    }),
    analyze: vi.fn<NonNullable<Dependencies["analyze"]>>(async ({ wav, expectedText }) => {
      const index = targets.findIndex((target) => target.expectedText === expectedText);
      if (index < 0) throw new Error("Unexpected analysis text");
      return analysis(wav, expectedText, [300, 350, 400][index]);
    }),
  };
  return { root, input, plan, targets, waves, deps };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

async function traceFiles(root: string) {
  const traceRoot = path.join(root, "voxcpm2-product", "long-text");
  const runs = await readdir(traceRoot);
  expect(runs).toHaveLength(1);
  return readdir(path.join(traceRoot, runs[0]));
}

function assertScaledCopy(actual: Float32Array, source: Float32Array, offset: number, gain: number) {
  let largestError = 0;
  for (let index = 0; index < source.length; index++) {
    largestError = Math.max(largestError, Math.abs(actual[offset + index] - source[index] * gain));
    if (source[index] === 0) expect(actual[offset + index]).toBe(0);
  }
  expect(largestError).toBeLessThan(2 / 32767);
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("voice-longtext-test-")) {
      throw new Error("Refusing to clean a directory outside this test's temporary workspace");
    }
    await rm(resolved, { recursive: true, force: true });
  }
});

describe("long-text PCM assembly", () => {
  it("applies one whole-result gain while preserving group levels, sample shapes, internal pauses and speed", () => {
    const waves = [groupWave({ amplitude: .2, leadingMs: 5, pauseMs: 13, trailingMs: 15 }),
      groupWave({ amplitude: .05, leadingMs: 10, pauseMs: 17, trailingMs: 20 })];
    const source = waves.map((wav) => decodePcmWav(wav));
    const result = assembleVoiceGroups([
      { wav: waves[0], leadingQuietMs: 5, trailingQuietMs: 15 },
      { wav: waves[1], leadingQuietMs: 10, trailingQuietMs: 20 },
    ], [{ durationMs: 180, source: "default", category: "short" }]);
    const output = decodePcmWav(result.wav);
    const addedFrames = (180 - 15 - 10) * 48;
    const secondStart = source[0].samples.length + addedFrames;
    expect(output.sampleRate).toBe(sampleRate);
    expect(output.channels).toBe(1);
    expect(output.samples.length).toBe(source[0].samples.length + source[1].samples.length + addedFrames);
    expect(result.joins[0].actualDurationMs).toBe(180);
    const gain = 10 ** (result.loudnessGainDb / 20);
    assertScaledCopy(output.samples, source[0].samples, 0, gain);
    assertScaledCopy(output.samples, source[1].samples, secondStart, gain);
    expect(output.samples.slice(source[0].samples.length, secondStart).every((value) => value === 0)).toBe(true);
    const active = output.samples.filter((sample) => sample !== 0);
    const activeRmsDb = 20 * Math.log10(Math.sqrt(active.reduce((sum, value) => sum + value * value, 0) / active.length));
    expect(activeRmsDb).toBeCloseTo(-27, 2);
    // A separate normalization for each group would destroy this 4:1 ratio.
    expect(output.samples[5 * 48] / output.samples[secondStart + 10 * 48]).toBeCloseTo(4, 2);
  });

  it("preserves protected quiet edges longer than the desired join and reports the actual pause", () => {
    const waves = [groupWave({ trailingMs: 120 }), groupWave({ leadingMs: 100 })];
    const source = waves.map((wav) => decodePcmWav(wav));
    const result = assembleVoiceGroups([
      { wav: waves[0], leadingQuietMs: 10, trailingQuietMs: 120 },
      { wav: waves[1], leadingQuietMs: 100, trailingQuietMs: 10 },
    ], [{ durationMs: 180, source: "default", category: "short" }]);
    const output = decodePcmWav(result.wav);
    expect(result.joins[0]).toMatchObject({ durationMs: 180, actualDurationMs: 220 });
    expect(output.samples.length).toBe(source[0].samples.length + source[1].samples.length);
    const gain = 10 ** (result.loudnessGainDb / 20);
    assertScaledCopy(output.samples, source[0].samples, 0, gain);
    assertScaledCopy(output.samples, source[1].samples, source[0].samples.length, gain);
  });
});

describe("long-text generation orchestration with injected engine and alignment", () => {
  it.each(["。……", "慢".repeat(501)])("rejects unsupported input before analysis or native generation", async (text) => {
    const { input, deps } = await fixture();
    await expect(generateVoiceLongText({ ...input, text }, deps)).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.plan).not.toHaveBeenCalled();
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it("saves original group PCM and assembles a 48 kHz mono result using measured adjacent pauses", async () => {
    const { root, input, waves, deps } = await fixture();
    const result = await generateVoiceLongText(input, deps);
    const metadata = result.provenance.longText!;
    expect(deps.plan).toHaveBeenCalledOnce();
    expect(deps.generate).toHaveBeenCalledTimes(3);
    expect(deps.analyze).toHaveBeenCalledTimes(3);
    expect(metadata.joins.map((join) => join.actualDurationMs)).toEqual([330, 380]);
    expect(metadata.groups.map((group) => group.attempts)).toEqual([1, 1, 1]);
    expect(metadata.groups[0].paddingClauses.length).toBeGreaterThan(0);
    expect(metadata.groups[2].paddingClauses).toEqual([]);
    for (let index = 0; index < waves.length; index++) {
      const stored = await readFile(resolveClipAssetPath(metadata.groups[index].asset.assetId, input.config));
      expect(new Uint8Array(stored)).toEqual(waves[index]);
      expect(metadata.groups[index].asset.duration).toBe(decodePcmWav(waves[index]).samples.length / sampleRate);
    }
    const output = decodePcmWav(result.wav);
    expect(output).toMatchObject({ sampleRate, channels: 1 });
    expect(output.samples.length).toBe(waves.reduce((sum, wav) => sum + decodePcmWav(wav).samples.length, 0) + (330 - 20 + 380 - 20) * 48);
    const sessions = [...deps.generate.mock.calls, ...deps.analyze.mock.calls].map((call) => call[1]?.runtimeSession);
    expect(sessions[0]?.runtimeRoot).toBe(path.resolve(root));
    expect(sessions.every((session) => session === sessions[0])).toBe(true);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(await traceFiles(root)).toEqual(expect.arrayContaining(["result.json", "assembled.wav", "groups.json"]));
  });

  it("bounds an unsafe group to three takes, preserves prior groups, and produces no final candidate audio", async () => {
    const { root, input, deps, targets } = await fixture();
    deps.analyze.mockImplementation(async ({ wav, expectedText }) => {
      if (expectedText === targets[0].expectedText) return analysis(wav, expectedText);
      throw new VoiceGroupAnalysisError("unsafe word boundary", 422);
    });
    await expect(generateVoiceLongText(input, deps)).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining("第 2 组") });
    expect(deps.generate.mock.calls.map(([request]) => request.text)).toEqual([targets[0].text, targets[1].text, targets[1].text, targets[1].text]);
    expect(deps.analyze).toHaveBeenCalledTimes(4);
    expect(await readdir(input.config.clipAssetRoot)).toHaveLength(1);
    const files = await traceFiles(root);
    expect(files).toContain("failure.json");
    expect(files).not.toContain("result.json");
    expect(files).not.toContain("assembled.wav");
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });

  it.each(["cancel", "timeout"] as const)("stops the current simulated native process on %s and never launches later groups", async (reason) => {
    const { root, input, deps } = await fixture();
    const controller = new AbortController();
    const started = deferred<void>();
    const terminated = vi.fn();
    deps.generate.mockImplementation(async ({ signal }, dependency) => {
      dependency?.runtimeSession?.processStarted(123456);
      started.resolve();
      return new Promise((_, reject) => {
        signal!.addEventListener("abort", () => {
          terminated();
          dependency?.runtimeSession?.processExited();
          reject(new VoxCpm2Error("Cancelled fixture", 499));
        }, { once: true });
      });
    });
    const pending = generateVoiceLongText({ ...input, signal: controller.signal }, { ...deps, timeoutMs: reason === "timeout" ? 1_000 : 5_000 });
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: reason === "timeout" ? 504 : 499 });
    await started.promise;
    if (reason === "cancel") controller.abort();
    await rejected;
    expect(terminated).toHaveBeenCalledOnce();
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.analyze).not.toHaveBeenCalled();
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(await traceFiles(root)).not.toContain("assembled.wav");
  });

  it("reserves the native runtime between groups so a second request cannot start another engine call", async () => {
    const { root, input, deps } = await fixture();
    const analyzing = deferred<void>();
    const resume = deferred<void>();
    deps.analyze.mockImplementationOnce(async ({ wav, expectedText }) => {
      analyzing.resolve();
      await resume.promise;
      return analysis(wav, expectedText);
    });
    const first = generateVoiceLongText(input, deps);
    await analyzing.promise;
    const lock = JSON.parse(await readFile(path.join(root, "locks", "voxcpm2-generation.lock"), "utf8"));
    expect(lock.childPid).toBeNull();
    const secondPlan = vi.fn(deps.plan.getMockImplementation()!);
    const secondGenerate = vi.fn(deps.generate.getMockImplementation()!);
    try {
      await expect(generateVoiceLongText(input, { ...deps, plan: secondPlan, generate: secondGenerate })).rejects.toMatchObject({ statusCode: 409 });
      expect(secondPlan).not.toHaveBeenCalled();
      expect(secondGenerate).not.toHaveBeenCalled();
    } finally {
      resume.resolve();
      await first;
    }
    expect(deps.generate).toHaveBeenCalledTimes(3);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });

  it.each(["readiness", "generation", "analysis"] as const)("does not reroll a configuration or resource failure at %s", async (stage) => {
    const { input, deps } = await fixture();
    if (stage === "readiness") deps.readiness.mockResolvedValue({ available: false, reason: "ASR unavailable" });
    if (stage === "generation") deps.generate.mockRejectedValue(new VoxCpm2Error("Model configuration unavailable", 503));
    if (stage === "analysis") deps.analyze.mockRejectedValue(new VoiceGroupAnalysisError("ASR unavailable", 503));
    await expect(generateVoiceLongText(input, deps)).rejects.toMatchObject({ statusCode: 503 });
    expect(deps.generate).toHaveBeenCalledTimes(stage === "readiness" ? 0 : 1);
    expect(deps.analyze).toHaveBeenCalledTimes(stage === "analysis" ? 1 : 0);
    expect(deps.plan).toHaveBeenCalledTimes(stage === "readiness" ? 0 : 1);
  });

  it.each([0, 1])("rerolls group %i, updates first-group provenance, and reuses other assets without clearing prior warnings", async (retryGroupIndex) => {
    const { input, deps, targets, waves } = await fixture();
    waves[1] = groupWave({ pauseMs: 300, amplitude: .05 });
    waves[2] = groupWave({ pauseMs: 300, amplitude: .1 });
    deps.analyze.mockImplementation(async ({ wav, expectedText }) => analysis(wav, expectedText, 300));
    const first = await generateVoiceLongText(input, deps);
    const priorMetadata = first.provenance.longText!;
    const priorAsset = await saveClipAsset({ config: input.config, clipId: input.clipId, wav: first.wav,
      duration: decodePcmWav(first.wav).samples.length / sampleRate });
    const original = makeVoiceCandidateFixture({ candidateId: "original_long_text", provenance: first.provenance, asset: priorAsset,
      qualityWarnings: ["这条候选可能有削波失真，请试听后决定是否采用。"] });
    const snapshot = JSON.stringify(original);
    const priorFiles = await Promise.all(priorMetadata.groups.map((group) => readFile(resolveClipAssetPath(group.asset.assetId, input.config))));
    expect(priorMetadata.joins.map((join) => join.durationMs)).toEqual([300, 300]);
    const retryWave = groupWave({ pauseMs: 440, amplitude: .12 });
    const retryParameters = { ...makeVoiceCandidateFixture().provenance.parameters,
      generatedSteps: decodePcmWav(retryWave).samples.length / 7680, maxSteps: 600 };
    const plan = vi.fn<NonNullable<Dependencies["plan"]>>().mockRejectedValue(new Error("A group retry must never call a text model"));
    const generate = vi.fn<NonNullable<Dependencies["generate"]>>().mockResolvedValue({
      wav: retryWave, provenance: { ...makeVoiceCandidateFixture().provenance, seed: 999, parameters: retryParameters }, qualityWarnings: [],
    });
    const analyze = vi.fn<NonNullable<Dependencies["analyze"]>>(async ({ wav, expectedText }) => analysis(wav, expectedText, 440));
    const retried = await generateVoiceLongText({ ...input, analysisProvider: "api", retryCandidate: original, retryGroupIndex }, { ...deps, plan, generate, analyze });
    const updated = retried.provenance.longText!;
    expect(plan).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledOnce();
    expect(analyze).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0].text).toBe(targets[retryGroupIndex].text);
    expect(analyze.mock.calls[0][0].expectedText).toBe(targets[retryGroupIndex].expectedText);
    expect(updated).toMatchObject({ baseCandidateId: original.candidateId, rerolledGroup: retryGroupIndex, analysisProvider: "rules" });
    for (const index of [0, 1, 2].filter((index) => index !== retryGroupIndex)) expect(updated.groups[index]).toEqual(priorMetadata.groups[index]);
    expect(updated.groups[retryGroupIndex].asset.assetId).not.toBe(priorMetadata.groups[retryGroupIndex].asset.assetId);
    expect(updated.groups[retryGroupIndex].seed).toBe(999);
    expect(retried.provenance.seed).toBe(retryGroupIndex === 0 ? 999 : original.provenance.seed);
    const firstGroupParameters = retryGroupIndex === 0 ? retryParameters : priorMetadata.groups[0].parameters;
    expect(retried.provenance.parameters).toMatchObject(firstGroupParameters);
    expect(retried.provenance.parameters.generatedSteps).toBe(firstGroupParameters.generatedSteps);
    expect(updated.joins.map((join) => join.actualDurationMs)).toEqual(retryGroupIndex === 0 ? [370, 300] : [370, 370]);
    // A partial retry cannot certify that an earlier audio caution is resolved.
    expect(retried.qualityWarnings).toEqual(original.qualityWarnings);
    expect(JSON.stringify(original)).toBe(snapshot);
    for (let index = 0; index < priorMetadata.groups.length; index++) {
      expect(await readFile(resolveClipAssetPath(priorMetadata.groups[index].asset.assetId, input.config))).toEqual(priorFiles[index]);
    }
    expect(new Uint8Array(await readFile(resolveClipAssetPath(priorAsset.assetId, input.config)))).toEqual(first.wav);
  });
});
