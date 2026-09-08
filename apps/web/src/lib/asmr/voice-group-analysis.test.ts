import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16MonoWav } from "./procedural-audio";
import { analyzeVoiceGroup, getVoiceAnalysisReadiness, type VoiceAnalysisSpawn } from "./voice-group-analysis";

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

function successfulSpawn(wav: Uint8Array, response: unknown = validResult): VoiceAnalysisSpawn {
  return vi.fn((_command, args, options) => {
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: "ignore", env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } });
    expect(args.slice(-2, -1)).toEqual(["--request"]);
    const process = child();
    setImmediate(async () => {
      const request = JSON.parse(await readFile(args.at(-1)!, "utf8"));
      expect(request.expectedText).toBe("慢慢放松。");
      expect(request.followingText).toBe("");
      await writeFile(request.outputWav, wav);
      await writeFile(request.outputJson, JSON.stringify(response));
      process.emit("close", 0);
    });
    return process;
  });
}

describe("local voice-group verification", () => {
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
