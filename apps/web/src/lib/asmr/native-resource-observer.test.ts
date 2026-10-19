import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { startNativeResourceObserver, type NativeResourceObserverSpawn } from "./native-resource-observer";

const config = { runtimeRoot: "runtime", voiceAnalysisPythonPath: "configured/python.exe" } as LocalRuntimeConfig;
const metrics = {
  physicalAvailableBytes: null, globalCommitUsedBytes: null, globalCommitLimitBytes: null,
  globalCommitAvailableBytes: null, nativeWorkingSetBytes: null,
  nativePeakWorkingSetBytes: null, nativePrivateBytes: null,
};
const summary = () => ({
  version: 1, nativePid: 1234, observerPid: 5678,
  startedAt: "2026-10-19T00:00:00+00:00", finishedAt: "2026-10-19T00:00:01+00:00",
  durationSeconds: 1, stopReason: "native_unavailable", sampleCount: 1,
  sampleIntervalMs: 250, metrics, samples: [{ elapsedSeconds: 0, ...metrics }],
  gpu: { status: "unavailable", sampleCount: 0, devices: [] },
  sources: {
    system: "GetPerformanceInfo: global CommitTotal/CommitLimit/PhysicalAvailable * PageSize",
    native: "GetProcessMemoryInfo: PROCESS_MEMORY_COUNTERS_EX",
    gpu: "nvidia-smi: whole-device framebuffer; sampled values do not establish OOM causality",
  },
  unavailable: ["native_process_unavailable"],
});

function fixture(options: { finishTimeoutMs?: number } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    pid: 5678, stdin, stdout, kill: vi.fn(() => true),
  });
  const spawnImpl = vi.fn<NativeResourceObserverSpawn>(() => child);
  const isFile = vi.fn<(filename: string) => Promise<boolean>>().mockResolvedValue(true);
  const readVenvConfig = vi.fn<(filename: string) => Promise<string | undefined>>().mockResolvedValue(undefined);
  const dependencies = { platform: "win32" as const, spawnImpl, isFile, readVenvConfig, finishTimeoutMs: options.finishTimeoutMs ?? 30 };
  const close = (data: unknown = summary()) => {
    stdout.write(JSON.stringify(data) + "\n");
    child.emit("close", 0);
  };
  return { child, spawnImpl, isFile, dependencies, close };
}

describe("optional native resource observer", () => {
  it("does nothing outside Windows or without a native PID", async () => {
    const { dependencies, spawnImpl, isFile } = fixture();
    expect(await startNativeResourceObserver({ pid: 1234, config }, { ...dependencies, platform: "linux" })).toBeUndefined();
    for (const pid of [undefined, 0, -1, 1.5, Number.NaN]) {
      expect(await startNativeResourceObserver({ pid, config }, dependencies)).toBeUndefined();
    }
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(isFile).not.toHaveBeenCalled();
  });

  it("uses only file checks to select the configured Python and starts no model", async () => {
    const { dependencies, spawnImpl, child, close } = fixture();
    const observer = await startNativeResourceObserver({ pid: 1234, config }, dependencies);
    expect(spawnImpl).toHaveBeenCalledOnce();
    const [command, args, options] = spawnImpl.mock.calls[0];
    expect(command).toBe(config.voiceAnalysisPythonPath);
    expect(args).toEqual(["-I", "-S", "-B", expect.stringContaining("observe-native-resources.py"), "--pid", "1234", "--parent-pid", String(process.pid)]);
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let finishedInput = false;
    child.stdin.on("finish", () => { finishedInput = true; close(); });
    const result = observer!.finish();
    expect(observer!.finish()).toBe(result);
    expect(await result).toEqual(summary());
    expect(finishedInput).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("launches a venv's base Python directly instead of its Windows redirector", async () => {
    const { dependencies, spawnImpl, close } = fixture();
    const base = path.resolve("base-python", "python.exe");
    dependencies.readVenvConfig.mockResolvedValue(`home = ${path.dirname(base)}\nexecutable = ${base}\n`);
    const observer = await startNativeResourceObserver({ pid: 1234, config }, dependencies);
    expect(spawnImpl.mock.calls[0][0]).toBe(base);
    close();
    expect(await observer!.finish()).toEqual(summary());
  });

  it("does not use a known redirector when its base executable is missing", async () => {
    const { dependencies, spawnImpl } = fixture();
    dependencies.readVenvConfig.mockResolvedValue("executable = Z:\\missing-python\\python.exe\n");
    dependencies.isFile.mockImplementation(async (filename) => !filename.startsWith("Z:"));
    expect(await startNativeResourceObserver({ pid: 1234, config }, dependencies)).toBeUndefined();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("falls back to the existing ASR Python paths without importing their packages", async () => {
    const { dependencies, spawnImpl, close } = fixture();
    const fallback = path.join(config.runtimeRoot, "engines", "gpt-sovits", "env-comfyui-clone", "python.exe");
    dependencies.isFile.mockImplementation(async (filename: string) => filename.endsWith(".py") || filename === fallback);
    const observer = await startNativeResourceObserver({ pid: 1234, config }, dependencies);
    expect(spawnImpl.mock.calls[0][0]).toBe(fallback);
    close();
    expect(await observer!.finish()).toEqual(summary());
  });

  it("silently skips missing or unstatable optional runtimes", async () => {
    const { dependencies, spawnImpl } = fixture();
    dependencies.isFile.mockResolvedValue(false);
    expect(await startNativeResourceObserver({ pid: 1234, config }, dependencies)).toBeUndefined();
    dependencies.isFile.mockRejectedValue(new Error("stat failed"));
    expect(await startNativeResourceObserver({ pid: 1234, config }, dependencies)).toBeUndefined();
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it("does not propagate a monitor spawn failure", async () => {
    const { dependencies, spawnImpl } = fixture();
    spawnImpl.mockImplementation(() => { throw new Error("spawn failed"); });
    expect(await startNativeResourceObserver({ pid: 1234, config }, dependencies)).toBeUndefined();
  });

  it("bounds monitor output and keeps unavailable metrics unknown", async () => {
    const { dependencies, child, close } = fixture();
    const observer = await startNativeResourceObserver({ pid: 1234, config }, dependencies);
    child.stdout.write("x".repeat(200_000) + "\n");
    close();
    const result = await observer!.finish();
    expect(result?.metrics.nativePrivateBytes).toBeNull();
    expect(result?.samples[0].nativeWorkingSetBytes).toBeNull();
    expect(result?.gpu.devices).toEqual([]);
  });

  it("rejects malformed, oversized or unrelated summaries without failing generation", async () => {
    for (const data of ["invalid", { ...summary(), nativePid: 9999 }, { ...summary(), observerPid: 9999 },
      { ...summary(), samples: Array(33).fill(summary().samples[0]) }]) {
      const { dependencies, close } = fixture();
      const observer = await startNativeResourceObserver({ pid: 1234, config }, dependencies);
      close(data);
      expect(await observer!.finish()).toBeUndefined();
    }
  });

  it("limits finishing to two seconds and only kills the observer", async () => {
    const { dependencies, child } = fixture({ finishTimeoutMs: 5 });
    const observer = await startNativeResourceObserver({ pid: 1234, config }, dependencies);
    expect(await observer!.finish()).toBeUndefined();
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });

  it("contains asynchronous monitor errors", async () => {
    const { dependencies, child } = fixture();
    const observer = await startNativeResourceObserver({ pid: 1234, config }, dependencies);
    child.emit("error", new Error("monitor disappeared"));
    child.stdin.emit("error", new Error("closed pipe"));
    expect(await observer!.finish()).toBeUndefined();
  });
});
