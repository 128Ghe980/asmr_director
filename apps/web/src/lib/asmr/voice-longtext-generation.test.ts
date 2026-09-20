import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    pipeline: "serial" as const,
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

  it("delivers an entirely silent recording unchanged for the user to inspect", () => {
    const source = writePcm16Wav(new Float32Array(4800), sampleRate);
    const result = assembleVoiceGroups([{ wav: source, leadingQuietMs: 0, trailingQuietMs: 0 }], []);
    expect(result.wav).toEqual(source);
    expect(result.loudnessGainDb).toBe(0);
    expect(result.joins).toEqual([]);
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
    expect(metadata.groups.map((group) => group.checkStatus)).toEqual(["passed", "passed", "passed"]);
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

  it("keeps the full source independently when a verified group uses its normal extracted audio", async () => {
    const { root, input, deps, waves, targets } = await fixture();
    waves[0] = groupWave({ leadingMs: 150, trailingMs: 180 });
    const full = decodePcmWav(waves[0]);
    const cropped = writePcm16Wav(full.samples.slice(120 * 48, full.samples.length - 150 * 48), sampleRate);
    deps.analyze.mockImplementation(async ({ wav, expectedText }) => expectedText === targets[0].expectedText
      ? { ...analysis(cropped, expectedText, 300, 30, 30), cutStartSeconds: .12, cutEndSeconds: full.samples.length / sampleRate - .15 }
      : analysis(wav, expectedText));
    const result = await generateVoiceLongText(input, deps);
    const group = result.provenance.longText!.groups[0];
    const [run] = await readdir(path.join(root, "voxcpm2-product", "long-text"));
    expect(new Uint8Array(await readFile(path.join(root, "voxcpm2-product", "long-text", run, "group-1-take-1-source.wav")))).toEqual(waves[0]);
    expect(new Uint8Array(await readFile(resolveClipAssetPath(group.asset.assetId, input.config)))).toEqual(cropped);
    expect(group.checkStatus).toBe("passed");
    expect(group.asset.duration).toBeLessThan(full.samples.length / sampleRate);
  });

  it("delivers the complete uncut source for a rejected check and continues assembling later groups", async () => {
    const { root, input, deps, targets, waves, plan } = await fixture();
    deps.analyze.mockImplementation(async ({ wav, expectedText }) => {
      if (expectedText !== targets[1].expectedText) return analysis(wav, expectedText);
      throw new VoiceGroupAnalysisError("unsafe word boundary", 422, "cut_text_mismatch");
    });
    const result = await generateVoiceLongText(input, deps);
    const metadata = result.provenance.longText!;
    const group = metadata.groups[1];
    const fullSourceDuration = decodePcmWav(waves[1]).samples.length / sampleRate;
    expect(deps.generate.mock.calls.map(([request]) => request.text)).toEqual(targets.map((target) => target.text));
    expect(deps.analyze).toHaveBeenCalledTimes(3);
    expect(metadata.groups.map((item) => item.checkStatus)).toEqual(["passed", "review", "passed"]);
    expect(group).toMatchObject({
      attempts: 1, diagnosticCode: "cut_text_mismatch", transcript: "", coverage: 0,
      internalPausesMs: [], internalPauseClasses: plan.clausePauseClasses.slice(plan.groups[1].start, plan.groups[1].end),
      leadingQuietMs: 0, trailingQuietMs: 0, cutStartSeconds: 0, cutEndSeconds: fullSourceDuration,
      asset: { duration: fullSourceDuration },
    });
    expect(new Uint8Array(await readFile(resolveClipAssetPath(group.asset.assetId, input.config)))).toEqual(waves[1]);
    const output = decodePcmWav(result.wav);
    const firstLength = decodePcmWav(waves[0]).samples.length;
    const secondOffset = firstLength + Math.round((metadata.joins[0].actualDurationMs - metadata.groups[0].trailingQuietMs) * 48);
    assertScaledCopy(output.samples, decodePcmWav(waves[1]).samples, secondOffset, 10 ** (metadata.loudnessGainDb / 20));
    expect(result.qualityWarnings.join(" ")).toMatch(/第 2 段/);
    expect(result.qualityWarnings.join(" ")).toMatch(/完整原音|完整录音/);
    expect(result.qualityWarnings.join(" ")).toMatch(/重复|后续|补句/);
    const files = await traceFiles(root);
    expect(files).toEqual(expect.arrayContaining(["group-2-take-1-source.wav", "result.json", "assembled.wav"]));
    expect(files).not.toContain("group-2-take-2-source.wav");
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });

  it.each([
    "uncertain_word_alignment", "repeated_speech", "cut_text_mismatch", "no_verified_quiet_cut",
    "uncertain_internal_pause", "silent_audio", "clauses_do_not_cover_target", "future_diagnostic",
  ])("turns %s into a review warning while delivering every full source without automatic rerolls", async (code) => {
    const { root, input, deps, targets, waves } = await fixture();
    deps.analyze.mockRejectedValue(new VoiceGroupAnalysisError("unsafe word boundary", 422, code));
    const result = await generateVoiceLongText(input, deps);
    const metadata = result.provenance.longText!;
    expect(metadata.groups.map((group) => group.diagnosticCode)).toEqual([code, code, code]);
    expect(metadata.groups.map((group) => group.checkStatus)).toEqual(["review", "review", "review"]);
    expect(metadata.groups.map((group) => group.attempts)).toEqual([1, 1, 1]);
    expect(result.qualityWarnings.join(" ")).toContain(targets[0].expectedText);
    expect(result.qualityWarnings.join(" ")).not.toMatch(/安全边界|文案有误|unsafe word boundary|future_diagnostic/);
    expect(deps.generate).toHaveBeenCalledTimes(3);
    expect(deps.analyze).toHaveBeenCalledTimes(3);
    for (const group of metadata.groups) {
      expect(new Uint8Array(await readFile(resolveClipAssetPath(group.asset.assetId, input.config)))).toEqual(waves[group.index]);
      expect(group.internalPausesMs).toEqual([]);
      expect(group.internalPauseClasses).toEqual(["medium"]);
    }
    expect(await traceFiles(root)).toContain("assembled.wav");
  });

  it("preserves each group's different diagnostic without regenerating any source", async () => {
    const { root, input, deps } = await fixture();
    const codes = ["uncertain_word_alignment", "cut_text_mismatch", "no_verified_quiet_cut"];
    for (const code of codes) deps.analyze.mockRejectedValueOnce(new VoiceGroupAnalysisError("unsafe word boundary", 422, code));
    const result = await generateVoiceLongText(input, deps);
    expect(result.provenance.longText!.groups.map((group) => group.diagnosticCode)).toEqual(codes);
    expect(deps.generate).toHaveBeenCalledTimes(3);
    const traceRoot = path.join(root, "voxcpm2-product", "long-text");
    const [run] = await readdir(traceRoot);
    for (const [index, code] of codes.entries()) {
      const trace = JSON.parse(await readFile(path.join(traceRoot, run, `group-${index + 1}-take-1-failure.json`), "utf8"));
      expect(trace).toMatchObject({ code, stage: "analyze" });
    }
  });

  it("identifies model generation failure and retains its specific actionable message", async () => {
    const { input, deps } = await fixture();
    deps.generate.mockRejectedValue(new VoxCpm2Error("片段达到生成长度上限，请拆短台词后重试。", 502));
    const failure = await generateVoiceLongText(input, deps).catch((error: unknown) => error);
    expect(failure).toMatchObject({ statusCode: 502, message: "片段达到生成长度上限，请拆短台词后重试。" });
    expect((failure as Error).message).not.toMatch(/台词未能核对|分段位置|原声已保留/);
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it("retains a published raw recording even if the provider then reports an incomplete generation", async () => {
    const { root, input, deps, waves } = await fixture();
    deps.generate.mockImplementation(async ({ onRawOutput }) => {
      await onRawOutput!(waves[0]);
      throw new VoxCpm2Error("本次录音达到生成长度上限。", 502);
    });
    await expect(generateVoiceLongText(input, deps)).rejects.toMatchObject({ statusCode: 502 });
    const [run] = await readdir(path.join(root, "voxcpm2-product", "long-text"));
    expect(new Uint8Array(await readFile(path.join(root, "voxcpm2-product", "long-text", run, "group-1-take-1-source.wav")))).toEqual(waves[0]);
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it("reports a full disk without rerunning TTS even when both failure logs also cannot be written", async () => {
    const { root, input, deps } = await fixture();
    const writeTrace = vi.fn<NonNullable<Dependencies["writeTrace"]>>(async (filePath, data) => {
      if (path.basename(filePath) === "plan.json") return writeFile(filePath, data);
      throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
    });
    const failure = await generateVoiceLongText(input, { ...deps, writeTrace }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ statusCode: 503, message: expect.stringContaining("第 1 段保存录音时失败") });
    expect((failure as Error).message).toContain("请检查运行目录的可用空间和写入权限");
    expect((failure as Error).message).not.toMatch(/模型生成失败|录音与台词/);
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.analyze).not.toHaveBeenCalled();
    const writes = writeTrace.mock.calls.map(([filePath]) => path.basename(filePath));
    expect(writes).toEqual(expect.arrayContaining(["plan.json", "group-1-take-1-failure.json", "failure.json"]));
    expect(writes.filter((name) => name.startsWith("group-1-take-1-source.wav"))).toHaveLength(1);
    expect(await traceFiles(root)).not.toContain("assembled.wav");
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });

  it("preserves a model resource error when writing its diagnostics fails", async () => {
    const { input, deps } = await fixture();
    const original = new VoxCpm2Error("本机模型运行环境不可用。", 503);
    deps.generate.mockRejectedValue(original);
    const writeTrace = vi.fn<NonNullable<Dependencies["writeTrace"]>>(async (filePath, data) => {
      if (path.basename(filePath) === "plan.json") return writeFile(filePath, data);
      throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    });
    await expect(generateVoiceLongText(input, { ...deps, writeTrace })).rejects.toBe(original);
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.analyze).not.toHaveBeenCalled();
    expect(writeTrace.mock.calls.map(([filePath]) => path.basename(filePath))).toEqual([
      "plan.json", "group-1-take-1-failure.json", "failure.json",
    ]);
  });

  it("still delivers all complete sources when only failure diagnostics cannot be written", async () => {
    const { input, deps } = await fixture();
    deps.analyze.mockRejectedValue(new VoiceGroupAnalysisError("unsafe word boundary", 422, "cut_text_mismatch"));
    const writeTrace = vi.fn<NonNullable<Dependencies["writeTrace"]>>(async (filePath, data) => {
      if (path.basename(filePath).endsWith("failure.json")) throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
      await writeFile(filePath, data);
    });
    const result = await generateVoiceLongText(input, { ...deps, writeTrace });
    expect(result.provenance.longText!.groups.map((group) => group.checkStatus)).toEqual(["review", "review", "review"]);
    expect(deps.generate).toHaveBeenCalledTimes(3);
    expect(deps.analyze).toHaveBeenCalledTimes(3);
  });

  it("stops after a real asset-directory write failure instead of generating another take", async () => {
    const { root, input, deps } = await fixture();
    const blockedAssetRoot = path.join(root, "asset-directory-is-a-file");
    await writeFile(blockedAssetRoot, "keep this file");
    input.config.clipAssetRoot = blockedAssetRoot;
    await expect(generateVoiceLongText(input, deps)).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining("保存录音时失败") });
    expect(deps.generate.mock.calls.length).toBeLessThanOrEqual(2);
    expect(deps.analyze).toHaveBeenCalledOnce();
    expect(await readFile(blockedAssetRoot, "utf8")).toBe("keep this file");
    expect(await traceFiles(root)).toEqual(expect.arrayContaining(["group-1-take-1-source.wav", "group-1-take-1-failure.json", "failure.json"]));
    expect(await traceFiles(root)).not.toContain("assembled.wav");
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });

  it("shows only a readable excerpt for a long failed passage without changing the text sent to the model", async () => {
    const { input, deps, plan, waves } = await fixture();
    plan.clauses[0] = "我们先坐下来，喝口水，休息一会儿，等身上暖和一点，再慢慢跟我说今天的事情。";
    plan.groups[0].text = plan.clauses.slice(0, 2).join("");
    input.text = plan.clauses.join("");
    deps.generate.mockResolvedValue({ wav: waves[0], provenance: makeVoiceCandidateFixture().provenance, qualityWarnings: [] });
    deps.analyze.mockRejectedValue(new VoiceGroupAnalysisError("unsafe word boundary", 422, "uncertain_word_alignment"));
    const result = await generateVoiceLongText(input, deps);
    expect(result.qualityWarnings.join(" ")).toContain(`第 1 段“${Array.from(plan.groups[0].text).slice(0, 28).join("")}…”`);
    expect(result.qualityWarnings.join(" ")).not.toContain(plan.groups[0].text);
    expect(deps.generate.mock.calls[0][0].text).toBe(buildLongTextInputs(plan)[0].text);
    expect(deps.analyze.mock.calls[0][0].expectedText).toBe(plan.groups[0].text);
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
          dependency?.runtimeSession?.processExited(123456);
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

  it("cancels both overlapping native stages and retains already completed full source audio", async () => {
    const { root, input, deps, waves, targets } = await fixture();
    const controller = new AbortController();
    const asrStarted = deferred<void>();
    const nextTtsStarted = deferred<void>();
    const terminated: string[] = [];
    deps.generate.mockImplementation(async ({ text, signal }, dependency) => {
      if (text === targets[0].text) return {
        wav: waves[0], provenance: makeVoiceCandidateFixture().provenance, qualityWarnings: [],
      };
      dependency?.runtimeSession?.processStarted(123456);
      nextTtsStarted.resolve();
      return new Promise((_, reject) => {
        signal!.addEventListener("abort", () => {
          terminated.push("tts");
          dependency?.runtimeSession?.processExited(123456);
          reject(new VoxCpm2Error("Cancelled fixture TTS", 499));
        }, { once: true });
      });
    });
    deps.analyze.mockImplementation(async ({ signal }, dependency) => {
      dependency?.runtimeSession?.processStarted(123457);
      asrStarted.resolve();
      return new Promise((_, reject) => {
        signal!.addEventListener("abort", () => {
          terminated.push("asr");
          dependency?.runtimeSession?.processExited(123457);
          reject(new VoiceGroupAnalysisError("Cancelled fixture ASR", 499));
        }, { once: true });
      });
    });
    const pending = generateVoiceLongText({ ...input, signal: controller.signal }, { ...deps, pipeline: "overlap" });
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 499 });
    await Promise.all([asrStarted.promise, nextTtsStarted.promise]);
    controller.abort();
    await rejected;
    expect(terminated.sort()).toEqual(["asr", "tts"]);
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(deps.analyze).toHaveBeenCalledOnce();
    const traceRoot = path.join(root, "voxcpm2-product", "long-text");
    const [run] = await readdir(traceRoot);
    expect(new Uint8Array(await readFile(path.join(traceRoot, run, "group-1-take-1-source.wav")))).toEqual(waves[0]);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
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

  it("continues generation when local ASR readiness is unavailable", async () => {
    const { input, deps } = await fixture();
    deps.readiness.mockResolvedValue({ available: false, reason: "ASR unavailable" });
    const result = await generateVoiceLongText(input, deps);
    expect(deps.plan).toHaveBeenCalledOnce();
    expect(deps.generate).toHaveBeenCalledTimes(3);
    expect(deps.analyze).not.toHaveBeenCalled();
    expect(result.provenance.longText!.groups.every((group) => group.checkStatus === "review")).toBe(true);
    expect(result.qualityWarnings.join(" ")).toMatch(/完整原音|完整录音/);
  });

  it.each([
    new VoiceGroupAnalysisError("ASR unavailable", 503),
    new VoiceGroupAnalysisError("ASR analysis timed out", 504),
    new Error("Unknown analysis exception"),
  ])("delivers original audio when the analyzer fails with %s", async (error) => {
    const { input, deps, waves } = await fixture();
    deps.analyze.mockRejectedValue(error);
    const result = await generateVoiceLongText(input, deps);
    expect(deps.generate).toHaveBeenCalledTimes(3);
    expect(deps.analyze).toHaveBeenCalledTimes(error instanceof VoiceGroupAnalysisError && [503, 504].includes(error.statusCode) ? 1 : 3);
    for (const group of result.provenance.longText!.groups) {
      expect(group.checkStatus).toBe("review");
      expect(group.diagnosticCode).toMatch(/^[a-z0-9_]+$/);
      expect(group.transcript).toBe("");
      expect(group.coverage).toBe(0);
      expect(new Uint8Array(await readFile(resolveClipAssetPath(group.asset.assetId, input.config)))).toEqual(waves[group.index]);
    }
    expect(result.qualityWarnings.join(" ")).not.toMatch(/ASR unavailable|Unknown analysis exception/);
  });

  it("does not reroll a model configuration failure", async () => {
    const { input, deps } = await fixture();
    deps.generate.mockRejectedValue(new VoxCpm2Error("Model configuration unavailable", 503));
    await expect(generateVoiceLongText(input, deps)).rejects.toMatchObject({ statusCode: 503, message: "Model configuration unavailable" });
    expect(deps.generate).toHaveBeenCalledOnce();
    expect(deps.analyze).not.toHaveBeenCalled();
  });

  it("starts independent text planning and ASR readiness together", async () => {
    const { input, deps, plan } = await fixture();
    const planning = deferred<void>();
    const checking = deferred<void>();
    const finishPlan = deferred<VoiceLongTextPlan>();
    const finishReadiness = deferred<{ available: boolean }>();
    deps.plan.mockImplementation(async () => { planning.resolve(); return finishPlan.promise; });
    deps.readiness.mockImplementation(async () => { checking.resolve(); return finishReadiness.promise; });
    const pending = generateVoiceLongText(input, { ...deps, pipeline: "overlap" });
    try {
      await Promise.all([planning.promise, checking.promise]);
      expect(deps.generate).not.toHaveBeenCalled();
    } finally {
      finishPlan.resolve(plan);
      finishReadiness.resolve({ available: true });
      await pending;
    }
  });

  it("overlaps one next TTS with the current ASR while bounding generation ahead and keeping ASR serial", async () => {
    const { input, deps, targets } = await fixture();
    const analysisStarted = [deferred<void>(), deferred<void>()];
    const analysisRelease = [deferred<void>(), deferred<void>()];
    const generated = [deferred<void>(), deferred<void>(), deferred<void>()];
    const originalGenerate = deps.generate.getMockImplementation()!;
    let activeAnalyzers = 0;
    let maximumAnalyzers = 0;
    deps.generate.mockImplementation(async (...args) => {
      const value = await originalGenerate(...args);
      const index = targets.findIndex((target) => target.text === args[0].text);
      generated[index].resolve();
      return value;
    });
    deps.analyze.mockImplementation(async ({ wav, expectedText }) => {
      const index = targets.findIndex((target) => target.expectedText === expectedText);
      activeAnalyzers++;
      maximumAnalyzers = Math.max(maximumAnalyzers, activeAnalyzers);
      try {
        if (index < 2) {
          analysisStarted[index].resolve();
          await analysisRelease[index].promise;
        }
        return analysis(wav, expectedText);
      } finally { activeAnalyzers--; }
    });
    const pending = generateVoiceLongText(input, { ...deps, pipeline: "overlap" });
    try {
      await Promise.all([analysisStarted[0].promise, generated[1].promise]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(deps.generate).toHaveBeenCalledTimes(2);
      expect(deps.analyze).toHaveBeenCalledOnce();
      analysisRelease[0].resolve();
      await Promise.all([analysisStarted[1].promise, generated[2].promise]);
      expect(deps.generate).toHaveBeenCalledTimes(3);
      expect(deps.analyze).toHaveBeenCalledTimes(2);
    } finally {
      analysisRelease[0].resolve();
      analysisRelease[1].resolve();
      await pending;
    }
    expect(maximumAnalyzers).toBe(1);
    expect(deps.analyze).toHaveBeenCalledTimes(3);
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
