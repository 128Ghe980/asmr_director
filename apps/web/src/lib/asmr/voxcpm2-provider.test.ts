import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { writePcm16MonoWav } from "./procedural-audio";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { generateVoxCpm2, type VoxCpm2Spawn } from "./voxcpm2-provider";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

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
  });
  it("uses Combined -r plus prompt WAV and keeps the normalized transcript trailing space", async () => {
    const { input, output } = await fixture();
    await generateVoxCpm2({ ...input, referenceMode: "with_reference_text" }, { spawnImpl: successfulSpawn(output, (args) => {
      expect(args[args.indexOf("-r") + 1]).toBe(args[args.indexOf("--prompt-wav") + 1]);
      expect(args[args.indexOf("--prompt-text") + 1]).toBe("欢迎光临 请慢慢放松 ");
    }) });
  });
  it("rejects missing transcripts, non-catalog references and invalid text before spawning", async () => {
    const { input } = await fixture();
    const spawnImpl = vi.fn();
    for (const change of [{ voicePackId: "../private.wav" }, { text: " " }, { text: "字".repeat(501) }, { voicePackId: "normal", referenceMode: "with_reference_text" as const }]) {
      await expect(generateVoxCpm2({ ...input, ...change }, { spawnImpl })).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(spawnImpl).not.toHaveBeenCalled();
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
  it("does not expose raw CLI errors or server paths", async () => {
    const { input } = await fixture();
    await expect(generateVoxCpm2(input, { spawnImpl: () => {
      const process = child();
      setImmediate(() => { process.stderr.write("private-path secret-token input-text"); process.emit("close", 1, null); });
      return process;
    } })).rejects.toThrow("VoxCPM2 生成失败，请稍后重试。");
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
