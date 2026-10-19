import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { writePcm16MonoWav } from "./procedural-audio";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { LocalStorageError } from "./local-storage-error";
import { generateVoxCpm2, type VoxCpm2Spawn } from "./voxcpm2-provider";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
import { getVoiceGenerationRoot } from "./voice-generation-recordings";
import type { NativeResourceObserver, NativeResourceSummary } from "./native-resource-observer";

async function failureDiagnostics(input: Awaited<ReturnType<typeof fixture>>["input"]) {
  const directory = path.join(getVoiceGenerationRoot(input.config), "diagnostics");
  return await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".json"))
    .map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8"))));
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "voxcpm-run-"));
  const profilePath = path.join(root, "profile.json");
  const output = writePcm16MonoWav(new Float32Array(7680 * 12).fill(0.05), 48_000);
  for (const name of ["cli.exe", "base.gguf", "acoustic.gguf"]) await writeFile(path.join(root, name), "fixture");
  await writeFile(path.join(root, "reference.wav"), writePcm16MonoWav(new Float32Array(1600).fill(.05), 16_000));
  await writeFile(path.join(root, "transcript.txt"), "欢迎光临。请慢慢放松！\n");
  await writeFile(profilePath, JSON.stringify({ version: 1, provider: "voxcpm2", cliPath: "cli.exe", baseModelPath: "base.gguf", acousticModelPath: "acoustic.gguf", defaultReferenceId: "soft", references: [{ id: "soft", displayName: "温柔", audioPath: "reference.wav", promptTextPath: "transcript.txt", licenseStatus: "user_confirmed", consentConfirmedAt: "2026-07-01T00:00:00Z" }, { id: "normal", displayName: "普通", audioPath: "reference.wav", promptTextPath: null, licenseStatus: "user_confirmed", consentConfirmedAt: "2026-07-01T00:00:00Z" }] }));
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root, ASMR_VOXCPM2_PROFILE_PATH: profilePath });
  const input = { config, text: "慢慢放松就好。", voicePackId: "soft", referenceMode: "reference_only" as const };
  return { root, output, input };
}

function child() {
  const process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn((signal: NodeJS.Signals) => { queueMicrotask(() => process.emit("close", null, signal)); return true; }), pid: 987654321 });
  return process;
}

function successfulSpawn(output: Uint8Array, inspect?: (args: readonly string[]) => void): VoxCpm2Spawn {
  return vi.fn((_command, args, options) => {
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    inspect?.(args);
    const process = child();
    setImmediate(async () => {
      await writeFile(args[args.indexOf("-o") + 1], output);
      process.emit("close", 0, null);
    });
    return process;
  });
}

describe("VoxCPM2 native provider", () => {
  it("retains optional resource evidence in a failure diagnostic without exposing it in the error", async () => {
    const { input } = await fixture();
    const resources: NativeResourceSummary = {
      version: 1, nativePid: 987654321, observerPid: 123, startedAt: "2026-10-19T00:00:00Z", finishedAt: "2026-10-19T00:00:01Z",
      durationSeconds: 1, stopReason: "native_exited", sampleCount: 4, sampleIntervalMs: 250,
      metrics: { physicalAvailableBytes: null, globalCommitUsedBytes: null, globalCommitLimitBytes: null,
        globalCommitAvailableBytes: { min: 400_000_000, max: 600_000_000, last: 400_000_000 },
        nativeWorkingSetBytes: null, nativePeakWorkingSetBytes: null, nativePrivateBytes: null },
      samples: [], gpu: { status: "unavailable", sampleCount: 0, devices: [] },
      sources: { system: "GetPerformanceInfo", native: "GetProcessMemoryInfo", gpu: "whole device" }, unavailable: ["gpu_unavailable"],
    };
    const finish = vi.fn(async () => resources);
    const observeResources = vi.fn(async () => ({ finish }));
    const spawnImpl: VoxCpm2Spawn = () => {
      const process = child();
      setImmediate(() => { process.stderr.write("CUDA error: CUBLAS_STATUS_NOT_INITIALIZED"); process.emit("close", 1, null); });
      return process;
    };
    const error = await generateVoxCpm2(input, { spawnImpl, observeResources }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ statusCode: 503, message: "显卡语音运行初始化失败，请稍后重试。" });
    expect(String(error)).not.toContain("400000000");
    expect(observeResources).toHaveBeenCalledWith({ pid: 987654321, config: input.config });
    expect(finish).toHaveBeenCalledOnce();
    expect(await failureDiagnostics(input)).toMatchObject([{ native: { resources } }]);
  });
  it.each(["start", "finish"])("an optional observer %s failure does not change the recording or runtime lock", async (stage) => {
    const { input, output, root } = await fixture();
    const observeResources = vi.fn(async () => {
      if (stage === "start") throw new Error("Optional observer unavailable");
      return { finish: async (): Promise<NativeResourceSummary> => { throw new Error("Optional summary unavailable"); } };
    });
    await expect(generateVoxCpm2(input, { spawnImpl: successfulSpawn(output), observeResources })).resolves.toHaveProperty("wav", output);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });
  it("bounds optional observer setup and closes a late monitor after delivering the recording", async () => {
    const { input, output, root } = await fixture();
    let started!: (observer: NativeResourceObserver) => void;
    const pendingObserver = new Promise<NativeResourceObserver>((resolve) => { started = resolve; });
    const finish = vi.fn(async () => undefined);
    await expect(generateVoxCpm2(input, { spawnImpl: successfulSpawn(output), observeResources: () => pendingObserver,
      resourceObservationWaitMs: 5 })).resolves.toHaveProperty("wav", output);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(finish).not.toHaveBeenCalled();
    started({ finish });
    await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  });
  it("hashes an executable larger than 128 MiB without treating it as a small config file", async () => {
    const { root, input, output } = await fixture();
    const cliPath = path.join(root, "cli.exe");
    const handle = await open(cliPath, "w");
    await handle.truncate(129 * 1024 * 1024);
    await handle.close();
    const hash = createHash("sha256");
    const zeroBlock = Buffer.alloc(1024 * 1024);
    for (let index = 0; index < 129; index += 1) hash.update(zeroBlock);
    try {
      const result = await generateVoxCpm2(input, { spawnImpl: successfulSpawn(output) });
      expect(result.provenance.runtimeVersion).toBe(`sha256:${hash.digest("hex")}`);
    } finally {
      await unlink(cliPath);
    }
  });
  it("generates one reference-only candidate with real provenance and low-VRAM controls", async () => {
    const { root, output, input } = await fixture();
    const result = await generateVoxCpm2(input, { seed: 42, spawnImpl: successfulSpawn(output, (args) => {
      expect(args).toEqual(expect.arrayContaining(["-r", path.join(root, "reference.wav"), "--low-vram", "--n-gpu-layers", "0", "--cfg", "2", "--timesteps", "10", "--temperature", "1"]));
      expect(args).not.toContain("--prompt-wav");
      expect(Number(args[args.indexOf("--steps") + 1])).toBeGreaterThanOrEqual(120);
    }) });
    expect(result.wav).toEqual(output);
    expect(result.provenance).toMatchObject({ provider: "voxcpm2", seed: 42, temperature: 1, voicePackId: "soft", referenceMode: "reference_only", generationMode: "clip", parameters: { lowVram: true, gpuLayers: 0, generatedSteps: 12 } });
    expect(JSON.stringify(result.provenance)).not.toContain(root);
    expect(await readdir(path.join(root, "voxcpm2-product", "runs"))).toEqual([]);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(await readdir(path.join(getVoiceGenerationRoot(input.config), "diagnostics")).catch(() => [])).toEqual([]);
  });
  it("uses Combined -r plus prompt WAV and keeps the normalized transcript trailing space", async () => {
    const { input, output } = await fixture();
    await generateVoxCpm2({ ...input, referenceMode: "with_reference_text" }, { spawnImpl: successfulSpawn(output, (args) => {
      expect(args[args.indexOf("-r") + 1]).toBe(args[args.indexOf("--prompt-wav") + 1]);
      expect(args[args.indexOf("--prompt-text") + 1]).toBe("欢迎光临 请慢慢放松 ");
    }) });
  });
  it("uses the paragraph-only corrected decoder, 800-step recipe and original natural reference punctuation", async () => {
    const { input, output, root } = await fixture();
    const paragraphCli = path.join(root, "paragraph.exe");
    await writeFile(paragraphCli, "corrected-decoder-fixture");
    const config = { ...input.config, voxcpm2ParagraphCliPath: paragraphCli };
    const spawnImpl = successfulSpawn(output, (args) => {
      expect(args[args.indexOf("-t") + 1]).toBe("先坐下吧。我替你倒杯茶。");
      expect(args[args.indexOf("--prompt-text") + 1]).toBe("欢迎光临。请慢慢放松！");
      expect(args[args.indexOf("--steps") + 1]).toBe("800");
      expect(args).toEqual(expect.arrayContaining(["--temperature", "1", "--cfg", "2", "--timesteps", "10", "--n-gpu-layers", "0", "--low-vram"]));
    });
    const result = await generateVoxCpm2({ ...input, config, text: "先坐下吧。我替你倒杯茶。", referenceMode: "with_reference_text" }, { paragraphMode: true, spawnImpl });
    expect(spawnImpl).toHaveBeenCalledWith(paragraphCli, expect.any(Array), expect.any(Object));
    expect(result.provenance.runtimeVersion).toBe(`sha256:${createHash("sha256").update("corrected-decoder-fixture").digest("hex")}`);
    expect(result.provenance.parameters.maxSteps).toBe(800);
    const legacySpawn = successfulSpawn(output);
    await generateVoxCpm2({ ...input, config }, { spawnImpl: legacySpawn });
    expect(legacySpawn).toHaveBeenCalledWith(path.join(root, "cli.exe"), expect.any(Array), expect.any(Object));
    await expect(generateVoxCpm2({ ...input, config }, { maxSteps: 800, spawnImpl: vi.fn() })).rejects.toMatchObject({ statusCode: 503 });
  });
  it("rejects missing transcripts, non-catalog references and invalid text before spawning", async () => {
    const { input } = await fixture();
    const spawnImpl = vi.fn();
    for (const change of [{ voicePackId: "../private.wav" }, { text: " " }, { text: "字".repeat(501) }, { voicePackId: "normal", referenceMode: "with_reference_text" as const }]) {
      await expect(generateVoxCpm2({ ...input, ...change }, { spawnImpl })).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(spawnImpl).not.toHaveBeenCalled();
  });
  it.each([
    "VoxCPM2Runtime: prefill context capacity exceeded: tokens=4097 capacity=4096",
    "VoxCPM2Runtime: decode context capacity exceeded: position=4096 capacity=4096",
    "VoxCPM2ResidualLM::prefill_kv: context capacity exceeded (tokens=4097 capacity=4096)",
    "VoxCPM2ResidualLM::forward_step: context capacity exceeded (position=-1 capacity=4096)",
    "Combined cloning failed: decode context capacity exceeded: position=4096 capacity=4096",
  ])("rejects a zero-exit partial recording after a native context capacity error and retains its bytes: %s", async (nativeMessage) => {
    const { input, output, root } = await fixture();
    const onRawOutput = vi.fn();
    const spawnImpl: VoxCpm2Spawn = (_command, args) => {
      const process = child();
      setImmediate(async () => {
        await writeFile(args[args.indexOf("-o") + 1], output);
        process.stderr.write(nativeMessage + "\n");
        process.emit("close", 0, null);
      });
      return process;
    };
    await expect(generateVoxCpm2({ ...input, onRawOutput }, { spawnImpl })).rejects.toMatchObject({ statusCode: 400 });
    expect(onRawOutput).toHaveBeenCalledExactlyOnceWith(output);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(await failureDiagnostics(input)).toMatchObject([{ failure: { statusCode: 400 }, native: { exitCode: 0 } }]);
  });
  it.each(["target", "reference"])("accepts a successful recording when the %s echo contains the capacity phrase", async (source) => {
    const { input, output, root } = await fixture();
    const spokenText = "请读 context capacity exceeded，还有 VoxCPM2Runtime: decode context capacity exceeded: position=4096 capacity=4096。";
    if (source === "reference") await writeFile(path.join(root, "transcript.txt"), spokenText);
    const spawnImpl: VoxCpm2Spawn = (_command, args) => {
      const process = child();
      setImmediate(async () => {
        await writeFile(args[args.indexOf("-o") + 1], output);
        process.stdout.write(`  Text:     "${args[args.indexOf("-t") + 1]}"\r\n`);
        process.stderr.write(`  Prompt text:   "${args[args.indexOf("--prompt-text") + 1]}"\r\n`);
        process.emit("close", 0, null);
      });
      return process;
    };
    const result = await generateVoxCpm2({ ...input, text: source === "target" ? spokenText : input.text,
      referenceMode: "with_reference_text" }, { spawnImpl });
    expect(result.wav).toEqual(output);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(await readdir(path.join(getVoiceGenerationRoot(input.config), "diagnostics")).catch(() => [])).toEqual([]);
  });
  it("does not infer a capacity error from target or reference echoes after an unrelated native exit", async () => {
    const { input } = await fixture();
    const spawnImpl: VoxCpm2Spawn = () => {
      const process = child();
      setImmediate(() => {
        process.stdout.write('  Text: "context capacity exceeded"\n');
        process.stderr.write('  Prompt text: "VoxCPM2Runtime: decode context capacity exceeded: position=4096 capacity=4096"\n');
        process.emit("close", 3221226505, null);
      });
      return process;
    };
    await expect(generateVoxCpm2(input, { spawnImpl })).rejects.toMatchObject({
      statusCode: 502, message: "VoxCPM2 生成失败，请稍后重试。",
    });
  });
  it("rejects a filesystem lock held by another process without launching a second CLI", async () => {
    const { root, input } = await fixture();
    await mkdir(path.join(root, "locks"));
    await writeFile(path.join(root, "locks", "voxcpm2-generation.lock"), JSON.stringify({ ownerPid: 123 }));
    const spawnImpl = vi.fn();
    await expect(generateVoxCpm2(input, { spawnImpl })).rejects.toMatchObject({ statusCode: 409 });
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(await readFile(path.join(root, "locks", "voxcpm2-generation.lock"), "utf8")).toContain("123");
  });
  it("retires a failed spawn without a PID only once and preserves an overlapping ASR reservation", async () => {
    const { input, root } = await fixture();
    const process = Object.assign(new EventEmitter(), { pid: undefined, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    await withVoxCpm2RuntimeSession(input.config, undefined, async (runtimeSession) => {
      runtimeSession.processStarted(22);
      try {
        await expect(generateVoxCpm2(input, { runtimeSession, spawnImpl: () => {
          setImmediate(() => { process.emit("error", new Error("spawn unavailable")); process.emit("close", -2, null); });
          return process;
        } })).rejects.toMatchObject({ statusCode: 503 });
        const lock = JSON.parse(await readFile(path.join(root, "locks", "voxcpm2-generation.lock"), "utf8"));
        expect(lock.childPids).toEqual([22]);
      } finally { await runtimeSession.processExited(22); }
    });
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });
  it("holds the lock until cancellation actually stops the child and then allows another candidate", async () => {
    const { input, output, root } = await fixture();
    const controller = new AbortController();
    const process = child();
    process.kill.mockImplementation(() => true);
    let launched!: () => void;
    const started = new Promise<void>((resolve) => { launched = resolve; });
    const pending = generateVoxCpm2({ ...input, signal: controller.signal }, { spawnImpl: () => { launched(); return process; } });
    const assertion = expect(pending).rejects.toMatchObject({ statusCode: 499 });
    await started;
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
    expect(await readdir(path.join(root, "locks"))).toHaveLength(1);
    process.emit("close", null, "SIGKILL");
    await assertion;
    await expect(generateVoxCpm2(input, { spawnImpl: successfulSpawn(output) })).resolves.toHaveProperty("wav");
  });
  it("timeouts terminate and release a confirmed closed child with a safe error", async () => {
    const { input, root } = await fixture();
    const process = child();
    await expect(generateVoxCpm2(input, { timeoutMs: 10, spawnImpl: () => process })).rejects.toMatchObject({ statusCode: 504 });
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });
  it("keeps the lock when process termination cannot be confirmed", async () => {
    const { input, root } = await fixture();
    const process = child();
    process.kill.mockImplementation(() => false);
    await expect(generateVoxCpm2(input, { timeoutMs: 5, exitWaitMs: 5, spawnImpl: () => process })).rejects.toMatchObject({ statusCode: 503 });
    expect(await readdir(path.join(root, "locks"))).toHaveLength(1);
  });
  it("publishes final native bytes once after a late close without reading a live partial file", async () => {
    const { input, root, output } = await fixture();
    const process = child();
    process.kill.mockImplementation(() => false);
    let outputPath = "";
    let launched!: () => void;
    const started = new Promise<void>((resolve) => { launched = resolve; });
    let published!: () => void;
    const publication = new Promise<void>((resolve) => { published = resolve; });
    const onRawOutput = vi.fn(async () => { published(); });
    const pending = generateVoxCpm2({ ...input, onRawOutput }, {
      timeoutMs: 30, exitWaitMs: 5,
      spawnImpl: (_command, args) => {
        outputPath = args[args.indexOf("-o") + 1];
        launched();
        return process;
      },
    });
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 503 });
    await started;
    await writeFile(outputPath, output.slice(0, 100));
    await rejected;
    expect(onRawOutput).not.toHaveBeenCalled();
    expect((await failureDiagnostics(input))[0].native.exitConfirmed).toBe(false);
    expect(await readdir(path.join(root, "locks"))).toHaveLength(1);
    expect(await readdir(path.join(root, "voxcpm2-product", "runs"))).toHaveLength(1);
    await writeFile(outputPath, output);
    expect(onRawOutput).not.toHaveBeenCalled();
    process.emit("close", 0, null);
    await publication;
    expect(onRawOutput).toHaveBeenCalledExactlyOnceWith(output);
    await vi.waitFor(async () => {
      expect(await readdir(path.join(root, "locks"))).toEqual([]);
      expect(await readdir(path.join(root, "voxcpm2-product", "runs"))).toEqual([]);
    });
    expect(await failureDiagnostics(input)).toMatchObject([{ native: { exitConfirmed: true, exitCode: 0, signal: null } }]);
    process.emit("close", 0, null);
    expect(onRawOutput).toHaveBeenCalledOnce();
    await expect(generateVoxCpm2(input, { spawnImpl: successfulSpawn(output) })).resolves.toHaveProperty("wav");
  });
  it("retains late output and releases the stopped process lock if publishing fails", async () => {
    const { input, root, output } = await fixture();
    const process = child();
    process.kill.mockImplementation(() => false);
    let outputPath = "";
    const onRawOutput = vi.fn().mockRejectedValue(new Error("Disk unavailable"));
    await expect(generateVoxCpm2({ ...input, onRawOutput }, {
      timeoutMs: 5, exitWaitMs: 5, spawnImpl: (_command, args) => {
        outputPath = args[args.indexOf("-o") + 1];
        return process;
      },
    })).rejects.toMatchObject({ statusCode: 503 });
    await writeFile(outputPath, output);
    process.emit("close", 0, null);
    await vi.waitFor(async () => { expect(await readdir(path.join(root, "locks"))).toEqual([]); });
    expect(onRawOutput).toHaveBeenCalledExactlyOnceWith(output);
    expect(new Uint8Array(await readFile(outputPath))).toEqual(output);
  });
  it.each(["typed", "filesystem cause"] as const)("preserves the %s storage error from raw publication and retains its complete audio", async (kind) => {
    const { input, root, output } = await fixture();
    const error = kind === "typed" ? new LocalStorageError()
      : new Error("Could not publish original", { cause: Object.assign(new Error("disk full"), { code: "ENOSPC" }) });
    const onRawOutput = vi.fn().mockRejectedValue(error);
    let outputPath = "";
    const reported = await generateVoxCpm2({ ...input, onRawOutput }, {
      spawnImpl: successfulSpawn(output, (args) => { outputPath = args[args.indexOf("-o") + 1]; }),
    }).catch((caught: unknown) => caught);
    expect(reported).toBeInstanceOf(LocalStorageError);
    expect(reported).toMatchObject({ statusCode: 507, code: "INSUFFICIENT_STORAGE", message: "音频保存空间不足，请释放存储空间后重试。" });
    if (kind === "typed") expect(reported).toBe(error);
    expect(onRawOutput).toHaveBeenCalledWith(output);
    expect(new Uint8Array(await readFile(outputPath))).toEqual(output);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(await failureDiagnostics(input)).toMatchObject([{ failure: { statusCode: 507 }, native: { exitConfirmed: true } }]);
  });
  it("does not expose raw CLI errors or server paths", async () => {
    const { input } = await fixture();
    await expect(generateVoxCpm2(input, { spawnImpl: () => {
      const process = child();
      setImmediate(() => { process.stderr.write("private-path secret-token input-text"); process.emit("close", 1, null); });
      return process;
    } })).rejects.toThrow("VoxCPM2 生成失败，请稍后重试。");
  });
  it("persists bounded separate native tails, exit status and signal after removing run files", async () => {
    const { input, root } = await fixture();
    const error = await generateVoxCpm2(input, { spawnImpl: () => {
      const process = child();
      setImmediate(() => {
        process.stdout.write("discarded-stdout-head" + "o".repeat(100_000) + "stdout-tail input-secret");
        process.stderr.write("discarded-stderr-head" + "e".repeat(100_000) + "stderr-tail private-path");
        process.emit("close", 23, "SIGABRT");
      });
      return process;
    } }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: "VoxCPM2 生成失败，请稍后重试。", statusCode: 502 });
    expect(String(error)).not.toMatch(/private-path|input-secret|stdout-tail|stderr-tail/);
    expect(await readdir(path.join(root, "voxcpm2-product", "runs"))).toEqual([]);
    const records = await failureDiagnostics(input);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ version: 1, provider: "voxcpm2", native: { pid: 987654321, exitCode: 23, signal: "SIGABRT", exitConfirmed: true, spawnError: null } });
    expect(records[0].native.stdoutTail).toHaveLength(32768);
    expect(records[0].native.stderrTail).toHaveLength(32768);
    expect(records[0].native.stdoutTail.endsWith("stdout-tail input-secret")).toBe(true);
    expect(records[0].native.stderrTail.endsWith("stderr-tail private-path")).toBe(true);
    expect(JSON.stringify(records)).not.toContain("discarded-");
  });
  it("records a bounded spawn error without returning native details", async () => {
    const { input, root } = await fixture();
    const process = Object.assign(new EventEmitter(), { pid: undefined, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    await expect(generateVoxCpm2(input, { spawnImpl: () => {
      setImmediate(() => {
        process.emit("error", Object.assign(new Error("x".repeat(8000) + " private-cli-path"), { code: "ENOENT" }));
        process.emit("close", -2, null);
      });
      return process;
    } })).rejects.toMatchObject({ statusCode: 503, message: "VoxCPM2 无法启动，请检查本机运行环境。" });
    const [record] = await failureDiagnostics(input);
    expect(record.native).toMatchObject({ pid: null, exitCode: -2, exitConfirmed: true, spawnError: { name: "Error", code: "ENOENT" } });
    expect(record.native.spawnError.message).toHaveLength(4096);
    expect(record.native.spawnError.message.endsWith("private-cli-path")).toBe(true);
    expect(await readdir(path.join(root, "voxcpm2-product", "runs"))).toEqual([]);
  });
  it.each([
    ["CUDA error: out of memory", "语音模型的显卡内存分配失败，请检查显存和系统内存余量后重试。", 503],
    ["cudaMallocAsync failed: out of memory", "语音模型的显卡内存分配失败，请检查显存和系统内存余量后重试。", 503],
    ["CUDA error: CUBLAS_STATUS_NOT_INITIALIZED", "显卡语音运行初始化失败，请稍后重试。", 503],
    ["CUDA error: initialization error", "显卡语音运行初始化失败，请稍后重试。", 503],
    ["std::bad_alloc", "语音模型运行内存不足，请关闭占用较大的程序后重试。", 503],
    ["write failed: No space left on device", "音频保存空间不足，请释放存储空间后重试。", 507],
    ["write failed: [WinError 112]", "音频保存空间不足，请释放存储空间后重试。", 507],
    ["GGML_ASSERT(n_tokens <= n_batch) failed", "本次输入超过语音模型的上下文容量，请缩短生成范围后重试。", 400],
    ["VoxCPM2Runtime: prefill context capacity exceeded: tokens=4097 capacity=4096", "本次输入超过语音模型的上下文容量，请缩短生成范围后重试。", 400],
    ["VoxCPM2Runtime: decode context capacity exceeded: position=4096 capacity=4096", "本次输入超过语音模型的上下文容量，请缩短生成范围后重试。", 400],
    ["private/ggml-cuda/cpy.cu:228: GGML_ASSERT(grid_y < USHRT_MAX) failed", "生成音频超出本机解码容量，请缩短生成范围后重试。", 400],
  ])("classifies an exact native failure safely: %s", async (nativeMessage, message, statusCode) => {
    const { input } = await fixture();
    const reported = await generateVoxCpm2(input, { spawnImpl: () => {
      const process = child();
      setImmediate(() => { process.stderr.write(nativeMessage + " private-path input-secret"); process.emit("close", 1, null); });
      return process;
    } }).catch((caught: unknown) => caught);
    expect(reported).toMatchObject({ message, statusCode });
    if (statusCode === 507) expect(reported).toHaveProperty("code", "INSUFFICIENT_STORAGE");
    const [record] = await failureDiagnostics(input);
    expect(record.native.stderrTail).toContain(nativeMessage);
    expect(record.failure.message).not.toMatch(/private-path|input-secret|cpy\.cu/);
  });
  it("classifies the reference-encoding CUDA allocator OOM trace without retrying or changing the reference", async () => {
    const { input, root } = await fixture();
    const referencePath = path.join(root, "reference.wav");
    const referenceBefore = await readFile(referencePath);
    const nativeMessage = "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 757.27 MiB on device 0: cudaMalloc failed: out of memory\n"
      + "ggml_gallocr_reserve_n_impl: failed to allocate CUDA0 buffer of size 794056192\n"
      + "VoxCPM2Runtime: failed to reserve AudioVAE encode graph memory\n"
      + "Combined cloning failed: failed to reserve AudioVAE encode graph memory\n";
    const spawnImpl = vi.fn(() => {
      const process = child();
      setImmediate(() => { process.stderr.write(nativeMessage); process.emit("close", 1, null); });
      return process;
    });
    const reported = await generateVoxCpm2(input, { spawnImpl }).catch((caught: unknown) => caught);
    expect(reported).toMatchObject({ statusCode: 503, message: "语音模型的显卡内存分配失败，请检查显存和系统内存余量后重试。" });
    expect(String(reported)).not.toMatch(/757\.27|cudaMalloc|AudioVAE|794056192/);
    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(await readFile(referencePath)).toEqual(referenceBefore);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(await readdir(path.join(root, "voxcpm2-product", "runs"))).toEqual([]);
    const [record] = await failureDiagnostics(input);
    expect(record.native).toMatchObject({ exitCode: 1, signal: null, exitConfirmed: true, stderrTail: nativeMessage });
    expect(record.failure).toMatchObject({ statusCode: 503, message: "语音模型的显卡内存分配失败，请检查显存和系统内存余量后重试。" });
  });
  it("classifies the cuMemCreate CUDA OOM trace as a device allocation failure instead of host RAM exhaustion", async () => {
    const { input } = await fixture();
    const nativeMessage = "MiniCPMLM: context suspended for low-VRAM reference encoding\n"
      + "CUDA error: out of memory\n"
      + "  current device: 0, in function alloc at private/ggml-cuda.cu:530\n"
      + "  cuMemCreate(&handle, reserve_size, &prop, 0)\n"
      + "private/ggml-cuda.cu:105: CUDA error\n";
    const spawnImpl = vi.fn(() => {
      const process = child();
      setImmediate(() => { process.stderr.write(nativeMessage); process.emit("close", 3221226505, null); });
      return process;
    });
    const reported = await generateVoxCpm2(input, { spawnImpl }).catch((caught: unknown) => caught);
    expect(reported).toMatchObject({ statusCode: 503,
      message: "语音模型的显卡内存分配失败，请检查显存和系统内存余量后重试。" });
    expect(String(reported)).not.toMatch(/运行内存不足|关闭占用显卡|缩短参考|private|cuMemCreate/);
    expect(spawnImpl).toHaveBeenCalledOnce();
    const [record] = await failureDiagnostics(input);
    expect(record.native).toMatchObject({ exitCode: 3221226505, exitConfirmed: true, stderrTail: nativeMessage });
  });
  it.each([
    { label: "cudaMalloc invalid argument", nativeMessage: "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 757.27 MiB on device 0: cudaMalloc failed: invalid argument", exitCode: 1 },
    { label: "cudaMallocAsync invalid argument", nativeMessage: "cudaMallocAsync failed: invalid argument", exitCode: 1 },
    { label: "LF-separated allocation and memory messages", nativeMessage: "cudaMalloc failed:\nout of memory", exitCode: 1 },
    { label: "CRLF-separated allocation and memory messages", nativeMessage: "cudaMallocAsync failed:\r\nout of memory", exitCode: 1 },
    { label: "Windows fast-fail without an OOM diagnostic", nativeMessage: "native process terminated unexpectedly", exitCode: 3221226505 },
  ])("keeps $label as a generic failure rather than inferring GPU memory exhaustion", async ({ nativeMessage, exitCode }) => {
    const { input, root } = await fixture();
    const spawnImpl = vi.fn(() => {
      const process = child();
      setImmediate(() => { process.stderr.write(nativeMessage + " private-path input-secret"); process.emit("close", exitCode, null); });
      return process;
    });
    const reported = await generateVoxCpm2(input, { spawnImpl }).catch((caught: unknown) => caught);
    expect(reported).toMatchObject({ statusCode: 502, message: "VoxCPM2 生成失败，请稍后重试。" });
    expect(String(reported)).not.toMatch(/cudaMalloc|out of memory|private-path|input-secret/);
    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    const [record] = await failureDiagnostics(input);
    expect(record.native).toMatchObject({ exitCode, signal: null, exitConfirmed: true });
    expect(record.native.stderrTail).toContain(nativeMessage);
    expect(record.failure.statusCode).toBe(502);
  });
  it("classifies the imported-reference cuBLAS crash without retrying or changing the reference", async () => {
    const { input, root } = await fixture();
    const referencePath = path.join(root, "reference.wav");
    const referenceBefore = await readFile(referencePath);
    const spawnImpl = vi.fn(() => {
      const process = child();
      setImmediate(() => {
        process.stderr.write("Loading reference WAV: private-reference.wav\n  Reference: 15.00s, 16000 Hz\nMiniCPMLM: context suspended for low-VRAM reference encoding\nfatal   : Memory allocation failure\nCUDA error: CUBLAS_STATUS_NOT_INITIALIZED\n  current device: 0, in function cublas_handle at private/common.cuh:1476\n  cublasCreate_v2(&cublas_handles[device])\nprivate/ggml-cuda.cu:105: CUDA error\n");
        process.emit("close", 3221226505, null);
      });
      return process;
    });
    await expect(generateVoxCpm2(input, { spawnImpl })).rejects.toMatchObject({
      statusCode: 503,
      message: "显卡语音运行初始化失败，请稍后重试。",
    });
    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(await readFile(referencePath)).toEqual(referenceBefore);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect(await failureDiagnostics(input)).toMatchObject([{ native: { exitCode: 3221226505, exitConfirmed: true } }]);
  });
  it.each(["ENOSPC", "EDQUOT"])("retains native %s as a typed storage error", async (code) => {
    const { input, root } = await fixture();
    await expect(generateVoxCpm2(input, { spawnImpl: () => {
      throw Object.assign(new Error("private-runtime-path"), { code });
    } })).rejects.toMatchObject({ statusCode: 507, code: "INSUFFICIENT_STORAGE", message: "音频保存空间不足，请释放存储空间后重试。" });
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    expect((await failureDiagnostics(input))[0].native.spawnError.code).toBe(code);
  });
  it("keeps the storage signal and reservation when a native storage failure has not confirmed exit", async () => {
    const { input, root } = await fixture();
    const process = child();
    process.kill.mockImplementation(() => false);
    try {
      await expect(generateVoxCpm2(input, { exitWaitMs: 5, spawnImpl: () => {
        setImmediate(() => process.emit("error", Object.assign(new Error("native write failed"), { code: "ENOSPC" })));
        return process;
      } })).rejects.toMatchObject({ statusCode: 507, code: "INSUFFICIENT_STORAGE" });
      expect(await readdir(path.join(root, "locks"))).toHaveLength(1);
      expect((await failureDiagnostics(input))[0].native.exitConfirmed).toBe(false);
    } finally { process.emit("close", 1, null); }
    await vi.waitFor(async () => { expect(await readdir(path.join(root, "locks"))).toEqual([]); });
  });
  it("does not let unavailable diagnostics hide the generation failure or prevent cleanup", async () => {
    const { input, root } = await fixture();
    await mkdir(getVoiceGenerationRoot(input.config), { recursive: true });
    await writeFile(path.join(getVoiceGenerationRoot(input.config), "diagnostics"), "not a directory");
    await expect(generateVoxCpm2(input, { spawnImpl: () => {
      const process = child();
      setImmediate(() => process.emit("close", 1, null));
      return process;
    } })).rejects.toThrow("VoxCPM2 生成失败，请稍后重试。");
    expect(await readdir(path.join(root, "voxcpm2-product", "runs"))).toEqual([]);
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });
  it("rejects missing, malformed and mismatched-format WAVs without hiding bytes from the raw publisher", async () => {
    const { input } = await fixture();
    for (const wav of [new Uint8Array(), Buffer.from("not a WAV"), writePcm16MonoWav(new Float32Array(7680).fill(.05), 32000)]) {
      const onRawOutput = vi.fn().mockResolvedValue(undefined);
      await expect(generateVoxCpm2({ ...input, onRawOutput }, { maxSteps: 120, spawnImpl: successfulSpawn(wav) })).rejects.toHaveProperty("statusCode", 502);
      if (wav.length) expect(onRawOutput).toHaveBeenCalledWith(new Uint8Array(wav));
    }
  });
  it.each(["silent", "step_limit"])("delivers the exact %s recording with a warning instead of rejecting it", async (kind) => {
    const { input } = await fixture();
    const wav = writePcm16MonoWav(new Float32Array(7680 * (kind === "silent" ? 1 : 120)).fill(kind === "silent" ? 0 : .05), 48000);
    const onRawOutput = vi.fn().mockResolvedValue(undefined);
    const result = await generateVoxCpm2({ ...input, onRawOutput }, { maxSteps: 120, spawnImpl: successfulSpawn(wav) });
    expect(Buffer.from(result.wav).equals(Buffer.from(wav))).toBe(true);
    expect(onRawOutput).toHaveBeenCalledOnce();
    expect(Buffer.from(onRawOutput.mock.calls[0][0]).equals(Buffer.from(wav))).toBe(true);
    expect(result.qualityWarnings.join(" ")).toContain(kind === "silent" ? "接近静音" : "长度上限");
  });
  it("publishes an existing native output even when the process reports failure", async () => {
    const { input, output } = await fixture();
    const onRawOutput = vi.fn().mockResolvedValue(undefined);
    const spawnImpl: VoxCpm2Spawn = (_command, args) => {
      const process = child();
      setImmediate(async () => { await writeFile(args[args.indexOf("-o") + 1], output); process.emit("close", 1, null); });
      return process;
    };
    await expect(generateVoxCpm2({ ...input, onRawOutput }, { spawnImpl })).rejects.toHaveProperty("statusCode", 502);
    expect(onRawOutput).toHaveBeenCalledExactlyOnceWith(output);
  });
  it("does not start work for a pre-cancelled request", async () => {
    const { input } = await fixture();
    const controller = new AbortController();
    controller.abort();
    const spawnImpl = vi.fn();
    await expect(generateVoxCpm2({ ...input, signal: controller.signal }, { spawnImpl })).rejects.toHaveProperty("statusCode", 499);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});
