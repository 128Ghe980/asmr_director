import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { LocalRuntimeConfig } from "./local-runtime-config";

const byteCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const range = z.object({ min: byteCount, max: byteCount, last: byteCount }).strict().nullable();
const metricShape = {
  physicalAvailableBytes: range, globalCommitUsedBytes: range,
  globalCommitLimitBytes: range, globalCommitAvailableBytes: range,
  nativeWorkingSetBytes: range, nativePeakWorkingSetBytes: range, nativePrivateBytes: range,
};
const sampleShape = Object.fromEntries(Object.keys(metricShape).map((key) => [key, byteCount.nullable()])) as {
  [K in keyof typeof metricShape]: z.ZodNullable<typeof byteCount>;
};
const SummarySchema = z.object({
  version: z.literal(1), nativePid: z.number().int().positive(), observerPid: z.number().int().positive(),
  startedAt: z.string().max(64), finishedAt: z.string().max(64),
  durationSeconds: z.number().finite().nonnegative().max(610),
  stopReason: z.enum(["finished_stdin", "native_exited", "native_unavailable", "parent_exited", "parent_unavailable", "time_limit", "observer_error", "unsupported_platform"]),
  sampleCount: z.number().int().nonnegative().max(10_000), sampleIntervalMs: z.literal(250),
  metrics: z.object(metricShape).strict(),
  samples: z.array(z.object({ elapsedSeconds: z.number().finite().nonnegative().max(610), ...sampleShape }).strict()).max(32),
  gpu: z.object({
    status: z.enum(["available", "unavailable"]), sampleCount: z.number().int().nonnegative().max(100_000),
    devices: z.array(z.object({
      uuid: z.string().min(1).max(128), totalBytes: byteCount,
      minimumFreeBytes: byteCount, maximumUsedBytes: byteCount,
      lastFreeBytes: byteCount, lastUsedBytes: byteCount,
    }).strict()).max(16),
  }).strict(),
  sources: z.object({ system: z.string().max(256), native: z.string().max(256), gpu: z.string().max(256) }).strict(),
  unavailable: z.array(z.enum(["global_memory_unavailable", "native_process_unavailable", "gpu_unavailable", "job_guard_unavailable", "parent_unavailable", "observer_error"])).max(6),
}).strict();

/** Whole-device GPU values and sampled minima are observations, not OOM causes. */
export type NativeResourceSummary = z.infer<typeof SummarySchema>;
export type NativeResourceObserver = { finish: () => Promise<NativeResourceSummary | undefined> };
type ObserverChild = {
  pid?: number;
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  once(event: "error", callback: (error: Error) => void): unknown;
  once(event: "close", callback: () => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};
export type NativeResourceObserverSpawn = (
  command: string, args: readonly string[],
  options: { cwd: string; shell: false; windowsHide: true; stdio: ["pipe", "pipe", "ignore"]; env: NodeJS.ProcessEnv },
) => ObserverChild;
type Dependencies = {
  platform?: NodeJS.Platform;
  isFile?: (filename: string) => Promise<boolean>;
  readVenvConfig?: (filename: string) => Promise<string | undefined>;
  spawnImpl?: NativeResourceObserverSpawn;
  finishTimeoutMs?: number;
};
const MAX_STDOUT_BYTES = 65_536;

async function isFile(filename: string) {
  try { return (await stat(filename)).isFile(); } catch { return false; }
}

async function readVenvConfig(filename: string): Promise<string | undefined> {
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > 16_384) return undefined;
    return await readFile(filename, "utf8");
  } catch { return undefined; }
}

async function observerPython(filename: string, check: (filename: string) => Promise<boolean>, readConfig: NonNullable<Dependencies["readVenvConfig"]>) {
  // Windows venv python.exe can be a redirector with a different real PID.
  // A stdlib-only observer needs no venv packages; launch its base executable
  // directly so killing the tracked child also closes its GPU Job Object.
  for (const configPath of [path.resolve(path.dirname(filename), "..", "pyvenv.cfg"), path.resolve(path.dirname(filename), "pyvenv.cfg")]) {
    const config = await readConfig(configPath);
    if (config === undefined) continue;
    const executable = /^executable\s*=\s*(.+)$/im.exec(config)?.[1].trim();
    const home = /^home\s*=\s*(.+)$/im.exec(config)?.[1].trim();
    for (const base of [executable, home ? path.join(home, "python.exe") : undefined]) {
      if (base && path.isAbsolute(base) && await check(base)) return base;
    }
    return undefined;
  }
  return filename;
}

/**
 * Best-effort diagnostics only. Never reserves the native runtime, imports a
 * model, retries a take, changes its inputs or terminates the observed process.
 */
export async function startNativeResourceObserver(
  input: { pid?: number; config: LocalRuntimeConfig }, dependencies: Dependencies = {},
): Promise<NativeResourceObserver | undefined> {
  const nativePid = input.pid;
  if ((dependencies.platform ?? process.platform) !== "win32" || typeof nativePid !== "number"
    || !Number.isSafeInteger(nativePid) || nativePid <= 0 || nativePid > 0xffff_ffff) return undefined;
  try {
    const check = dependencies.isFile ?? isFile;
    const pythonCandidates = [
      ...(input.config.voiceAnalysisPythonPath ? [input.config.voiceAnalysisPythonPath] : []),
      path.join(input.config.runtimeRoot, "audio-quality-v1", ".venv", "Scripts", "python.exe"),
      path.join(input.config.runtimeRoot, "engines", "gpt-sovits", "env-comfyui-clone", "python.exe"),
    ];
    let pythonPath: string | undefined;
    for (const filename of pythonCandidates) {
      if (!(await check(filename))) continue;
      pythonPath = await observerPython(filename, check, dependencies.readVenvConfig ?? readVenvConfig);
      if (pythonPath) break;
    }
    if (!pythonPath) return undefined;
    let helper: string | undefined;
    for (const filename of [path.resolve("scripts", "observe-native-resources.py"), path.resolve("apps", "web", "scripts", "observe-native-resources.py")]) {
      if (await check(filename)) { helper = filename; break; }
    }
    if (!helper) return undefined;
    const child = (dependencies.spawnImpl ?? spawn)(pythonPath, ["-I", "-S", "-B", helper, "--pid", String(nativePid), "--parent-pid", String(process.pid)], {
      cwd: path.dirname(helper), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" },
    });
    let closed = false;
    let settle!: () => void;
    const exit = new Promise<void>((resolve) => { settle = () => { closed = true; resolve(); }; });
    child.once("close", settle);
    child.once("error", settle);
    // Broken optional pipes must never become unhandled EventEmitter errors.
    child.stdin?.on("error", () => {});
    child.stdout?.on("error", () => {});
    if (!child.pid) return undefined;
    let output = Buffer.alloc(0);
    const capture = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      output = Buffer.concat([output, bytes.subarray(-MAX_STDOUT_BYTES)]).subarray(-MAX_STDOUT_BYTES);
    };
    child.stdout?.on("data", capture);
    let finishing: Promise<NativeResourceSummary | undefined> | undefined;
    return {
      finish() {
        finishing ??= (async () => {
          try {
            // EOF requests a final sample and the helper's own child cleanup.
            try { child.stdin?.end(); } catch { /* Continue to the bounded exit wait. */ }
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              if (!closed) {
                await Promise.race([exit, new Promise<void>((resolve) => {
                  timer = setTimeout(resolve, Math.min(2000, Math.max(1, dependencies.finishTimeoutMs ?? 2000)));
                })]);
                // The Python helper places itself and its GPU query in a
                // kill-on-close Windows Job Object before starting that query.
                // If that guard is unavailable it never spawns nvidia-smi.
                if (!closed) try { child.kill("SIGKILL"); } catch { /* Diagnostics are optional. */ }
              }
            } finally { clearTimeout(timer); }
            for (const line of output.toString("utf8").trim().split("\n").slice(-4).reverse()) {
              try {
                const parsed = SummarySchema.safeParse(JSON.parse(line));
                if (parsed.success && parsed.data.nativePid === nativePid && parsed.data.observerPid === child.pid) return parsed.data;
              } catch { /* Ignore a partial line or optional helper diagnostic. */ }
            }
          } catch { /* A monitor failure cannot change a generation result. */ }
          finally { child.stdout?.removeListener("data", capture); }
          return undefined;
        })();
        return finishing;
      },
    };
  } catch { return undefined; }
}
