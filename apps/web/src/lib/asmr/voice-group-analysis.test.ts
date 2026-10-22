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
  boundaryOnly: { method: "whole_recording", alignmentSimilarity: 1, targetEndWordIndex: 1,
    contentVerified: false, internalPausePositions: [] },
  recognition: { analysisMode: "cutting_only", stage: "complete", expectedText: "慢慢放松。",
    sourceTranscript: "慢慢放松", targetTranscript: "慢慢放松",
    sourceWords: [{ text: "慢慢", start: .1, end: .3 }, { text: "放松", start: .3, end: .6 }] },
};

const recognition = { ...validResult.recognition, stage: "source_alignment" as const,
  alignment: { expected: "慢慢放松", recognizedPrefix: "慢慢放松", reason: "boundary_unlocatable" } };
const endpointApiEnv = { ASMR_PLANNER_API_URL: "https://example.test/v1", ASMR_PLANNER_API_MODEL: "fixture-model", ASMR_PLANNER_API_KEY: "fixture-only" };

function successfulSpawn(wav: Uint8Array, response: unknown = validResult, expectedText = "慢慢放松。", followingText = "", requireTwoSided?: boolean): VoiceAnalysisSpawn {
  return vi.fn((_command, args, options) => {
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: "ignore", env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } });
    expect(args.slice(-2, -1)).toEqual(["--request"]);
    const process = child();
    setImmediate(async () => {
      const request = JSON.parse(await readFile(args.at(-1)!, "utf8"));
      expect(request.expectedText).toBe(expectedText);
      expect(request.followingText).toBe(followingText);
      expect(request.cuttingOnly).toBe(true);
      expect(request.requireTwoSided).toBeUndefined();
      void requireTwoSided;
      await writeFile(request.outputWav, wav);
      await writeFile(request.outputJson, JSON.stringify(response));
      process.emit("close", 0);
    });
    return process;
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("cutting-only ASR protocol and acoustic safety", () => {
  it.each([0, .1, .5, 1])("accepts measured coverage %s without treating ASR text as content approval", async coverage => {
    const { input, readinessImpl } = await fixture();
    const response = { ...validResult, coverage, transcript: "完全不同", boundaryOnly: { ...validResult.boundaryOnly, alignmentSimilarity: .1 },
      recognition: { ...validResult.recognition, sourceTranscript: "完全不同", targetTranscript: "完全不同",
        sourceWords: [{ text: "完全", start: .1, end: .3 }, { text: "不同", start: .3, end: .6 }] } };
    const result = await analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav, response) });
    expect(result.coverage).toBe(coverage); expect(result.transcript).toBe("完全不同");
    expect(result.boundaryOnly?.contentVerified).toBe(false);
    expect(result.recognition?.contentComparison).toBeUndefined(); expect(result.recognition?.shortSentenceReview).toBeUndefined();
  });

  it("forwards only cutting purpose even if callers still pass legacy review flags", async () => {
    const { input, readinessImpl } = await fixture();
    const spawnImpl = successfulSpawn(input.wav);
    await analyzeVoiceGroup({ ...input, requireTwoSided: true, allowShortSentenceParticle: true, allowShortSentenceTextReview: true }, { readinessImpl, spawnImpl });
    expect(spawnImpl).toHaveBeenCalledOnce();
  });

  it.each([.05, 0])("retains the entire final recording without an ASR text anchor (amplitude %s)", async amplitude => {
    const { input, readinessImpl } = await fixture();
    const wav = writePcm16MonoWav(new Float32Array(48_000).fill(amplitude), 48_000);
    const response = { ...validResult, transcript: "", coverage: 0,
      boundaryOnly: { ...validResult.boundaryOnly, alignmentSimilarity: 0, targetEndWordIndex: -1 },
      recognition: { ...validResult.recognition, sourceTranscript: "", targetTranscript: "", sourceWords: [] } };
    const result = await analyzeVoiceGroup({ ...input, wav }, { readinessImpl, spawnImpl: successfulSpawn(wav, response) });
    expect(result.wav).toEqual(wav);
    expect(result).toMatchObject({ transcript: "", coverage: 0, cutStartSeconds: 0, cutEndSeconds: 1,
      boundaryOnly: { method: "whole_recording", targetEndWordIndex: -1, contentVerified: false } });
  });

  it.each(["marker", "boundary", "legacy_content", "legacy_review"])("rejects a legacy or mixed response missing the new %s protocol", async kind => {
    const { input, readinessImpl } = await fixture();
    const response = structuredClone(validResult) as Record<string, unknown>;
    const evidence = response.recognition as Record<string, unknown>;
    if (kind === "marker") delete evidence.analysisMode;
    if (kind === "boundary") delete response.boundaryOnly;
    if (kind === "legacy_content") evidence.contentComparison = { status: "matched", expected: "慢慢放松", recognized: "慢慢放松", similarity: 1, threshold: .9, substitutionCount: 0 };
    if (kind === "legacy_review") evidence.shortSentenceReview = { status: "needs_confirmation" };
    await expect(analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav, response) })).rejects.toMatchObject({ statusCode: 422 });
  });

  async function followingFixture() {
    const f = await fixture();
    const samples = new Float32Array(96_000).fill(.01);
    samples.fill(0, 28_800, 43_200);
    const source = writePcm16MonoWav(samples, 48_000);
    const cropped = writePcm16MonoWav(samples.slice(0, 36_000), 48_000);
    const followingText = "安静休息。";
    const response = { ...validResult, coverage: .2, transcript: "别字", cutEndSeconds: .75, trailingQuietMs: 150,
      boundaryOnly: { ...validResult.boundaryOnly, method: "ordered_word_boundary", alignmentSimilarity: .2, targetEndWordIndex: 0, followingStartWordIndex: 1 },
      cutValidation: { method: "two_sided", thresholdDbfs: -68, quietStartSeconds: .6, quietEndSeconds: .9 },
      recognition: { ...validResult.recognition, sourceTranscript: "别字另一句", targetTranscript: "别字", followingText,
        sourceWords: [{ text: "别字", start: .1, end: .5 }, { text: "另一句", start: 1.1, end: 1.5 }] } };
    return { ...f, input: { ...f.input, wav: source, followingText }, cropped, response };
  }

  it("accepts an exact source-PCM prefix with real quiet guards and changed ASR text", async () => {
    const f = await followingFixture();
    const result = await analyzeVoiceGroup(f.input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, f.response, f.input.expectedText, f.input.followingText) });
    expect(result.wav).toEqual(f.cropped); expect(result.cutValidation).toEqual(f.response.cutValidation);
    expect(await readdir(path.join(f.runtimeRoot, "voxcpm2-product", "analysis-runs"))).toEqual([]);
  });

  it.each(["missing_quiet", "guard", "loud_quiet", "wrong_following", "wrong_index", "fabricated_prefix", "cut_after_source", "nonzero_start"])("rejects unsafe acoustic/source evidence: %s", async kind => {
    const f = await followingFixture();
    const response = structuredClone(f.response);
    let input = f.input;
    if (kind === "missing_quiet") delete (response as Partial<typeof response>).cutValidation;
    if (kind === "guard") response.cutValidation.quietStartSeconds = .7;
    if (kind === "loud_quiet") input = { ...input, wav: writePcm16MonoWav(new Float32Array(96_000).fill(.05), 48_000) };
    if (kind === "wrong_following") response.recognition.followingText = "另一个请求。";
    if (kind === "wrong_index") response.boundaryOnly.followingStartWordIndex = 0;
    if (kind === "fabricated_prefix") response.recognition.targetTranscript = "未真实定位";
    if (kind === "cut_after_source") response.cutEndSeconds = 3;
    if (kind === "nonzero_start") response.cutStartSeconds = .1;
    await expect(analyzeVoiceGroup(input, { readinessImpl: f.readinessImpl, spawnImpl: successfulSpawn(f.cropped, response, input.expectedText, input.followingText) })).rejects.toMatchObject({ statusCode: 422 });
  });

  it.each(["sample_changed", "silent", "invalid_wav", "truncated"])("rejects changed or malformed PCM despite valid text evidence: %s", async kind => {
    const { input, readinessImpl } = await fixture();
    let output: Uint8Array = new Uint8Array(input.wav);
    if (kind === "sample_changed") output[44] ^= 1;
    if (kind === "silent") output = writePcm16MonoWav(new Float32Array(48_000), 48_000);
    if (kind === "invalid_wav") output[0] = 0;
    if (kind === "truncated") output = output.slice(0, -2);
    await expect(analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(output) })).rejects.toMatchObject({ statusCode: 422 });
  });

  it.each(["boundary_unlocatable", "ambiguous_boundary"])("preserves %s failure evidence without API selection or extra analysis", async code => {
    const { input, readinessImpl } = await fixture();
    const fetchImpl = vi.fn();
    const spawnImpl = successfulSpawn(input.wav, { version: 1, success: false, code, recognition });
    await expect(analyzeVoiceGroup(input, { readinessImpl, spawnImpl, fetchImpl, env: endpointApiEnv })).rejects.toMatchObject({ statusCode: 422, diagnosticCode: code, recognition });
    expect(fetchImpl).not.toHaveBeenCalled(); expect(spawnImpl).toHaveBeenCalledOnce();
  });

  it("retains a measured long internal pause and its clause index without trimming original PCM", async () => {
    const { input, readinessImpl } = await fixture();
    const samples = new Float32Array(432_000).fill(.05); samples.fill(0, 96_000, 216_000);
    const wav = writePcm16MonoWav(samples, 48_000);
    const response = { ...validResult, internalPausesMs: [2500], cutEndSeconds: 9,
      boundaryOnly: { ...validResult.boundaryOnly, internalPausePositions: [0] },
      recognition: { ...validResult.recognition, sourceWords: [{ text: "慢慢", start: .1, end: 1.9 }, { text: "放松", start: 4.6, end: 8.8 }] } };
    const request = { ...input, wav, clauses: ["慢慢", "放松"] };
    await expect(analyzeVoiceGroup(request, { readinessImpl, spawnImpl: successfulSpawn(wav, response) })).resolves.toMatchObject({ internalPausesMs: [2500], wav });
    await expect(analyzeVoiceGroup(request, { readinessImpl, spawnImpl: successfulSpawn(wav, { ...response, internalPausesMs: [10_001] }) })).rejects.toMatchObject({ statusCode: 422 });
  });

});

describe("voice analysis lifecycle, resource ownership and evidence recovery", () => {
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

it("keeps one worker and readiness check across groups, including an unresolved boundary", async () => {
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
        ? { version: 1, success: false, code: "boundary_unlocatable", recognition } : validResult));
      process.stdout.write(JSON.stringify({ requestPath, code: 0 }) + "\n");
    });
    const workerSpawnImpl = vi.fn(() => process);
    await withVoxCpm2RuntimeSession(input.config, undefined, async (runtimeSession) => {
      const dependencies = { runtimeSession, readinessImpl: readiness, workerSpawnImpl };
      await expect(analyzeVoiceGroup(input, dependencies)).rejects.toMatchObject({ diagnosticCode: "boundary_unlocatable", recognition });
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
      { ...validResult, coverage: -1 },
      { ...validResult, privateModelPath: "D:/private-model" },
      { ...validResult, leadingQuietMs: -1 },
    ]) {
      await expect(analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav, response) })).rejects.toMatchObject({ statusCode: 422 });
    }
  });

it("retains a bounded diagnostic code for server traces without exposing it as the user message", async () => {
    const { input, readinessImpl } = await fixture();
    await expect(analyzeVoiceGroup(input, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, { version: 1, success: false, code: "no_safe_quiet_cut" }),
    })).rejects.toMatchObject({ statusCode: 422, diagnosticCode: "no_safe_quiet_cut", message: expect.stringMatching(/切分|切点|原音/) });
  });

it("retains complete recognition on success and on a later invalid crop without accepting the crop", async () => {
    const { input, readinessImpl } = await fixture();
    const evidence = { ...validResult.recognition };
    const result = await analyzeVoiceGroup(input, { readinessImpl, spawnImpl: successfulSpawn(input.wav, { ...validResult, recognition: evidence }) });
    expect(result.recognition).toEqual(evidence);
    await expect(analyzeVoiceGroup(input, { readinessImpl,
      spawnImpl: successfulSpawn(input.wav, { ...validResult, recognition: evidence, cutEndSeconds: .7 }),
    })).rejects.toMatchObject({ statusCode: 422, recognition: evidence });
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

it("preserves the source recognition checkpoint when cancellation interrupts the cutting-only job", async () => {
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
