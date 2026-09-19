import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveClipAssetPath } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { PositionSchema, type TimelineClip } from "./schema";
import { SPATIAL_RENDER_VERSION } from "./spatial-settings";

export { SPATIAL_RENDER_VERSION } from "./spatial-settings";
export const MAX_SPATIAL_DURATION_SECONDS = 600;
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 192 * 1024 * 1024;
const MAX_PENDING_RENDERS = 8;

export class SpatialAudioError extends Error {
  constructor(message: string, public readonly statusCode = 500) {
    super(message);
    this.name = "SpatialAudioError";
  }
}

export type RenderSpatialClipInput = {
  assetId: string;
  position: TimelineClip["position"];
  durationSeconds?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  config: LocalRuntimeConfig;
  signal?: AbortSignal;
};
export type SpatialClipResult = { wav: Uint8Array; spatialized: boolean };
type SpatialChild = {
  pid?: number;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};
export type SpatialSpawn = (
  command: string, args: readonly string[],
  options: { cwd: string; shell: false; windowsHide: true; stdio: ["ignore", "pipe", "pipe"]; env: NodeJS.ProcessEnv },
) => SpatialChild;
// Dependencies are only available to server callers/tests, never accepted by the API.
type Dependencies = { scriptPath?: string; spawnImpl?: SpatialSpawn; timeoutMs?: number; exitWaitMs?: number };

const cancelled = () => new SpatialAudioError("已取消空间处理。", 499);
function checkCancelled(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }

type QueueEntry = { signal?: AbortSignal; abort: () => void; resolve: (release: () => void) => void; reject: (error: Error) => void };
// Next's API and mix bundles share this process-wide gate, even if bundled separately.
const spatialGlobal = globalThis as typeof globalThis & { __asmrSpatialQueue?: { entries: QueueEntry[]; active: boolean } };
const queueState = spatialGlobal.__asmrSpatialQueue ??= { entries: [], active: false };
const renderQueue = queueState.entries;
function grantRender(entry: QueueEntry) {
  queueState.active = true;
  entry.signal?.removeEventListener("abort", entry.abort);
  let released = false;
  entry.resolve(() => {
    if (released) return;
    released = true;
    queueState.active = false;
    const next = renderQueue.shift();
    if (next) grantRender(next);
  });
}
function acquireRender(signal?: AbortSignal): Promise<() => void> {
  checkCancelled(signal);
  if (queueState.active && renderQueue.length >= MAX_PENDING_RENDERS) throw new SpatialAudioError("空间处理任务较多，请稍后再试。", 429);
  return new Promise((resolve, reject) => {
    const entry: QueueEntry = { signal, resolve, reject, abort: () => {
      const index = renderQueue.indexOf(entry);
      if (index >= 0) renderQueue.splice(index, 1);
      reject(cancelled());
    } };
    if (!queueState.active) grantRender(entry);
    else { renderQueue.push(entry); signal?.addEventListener("abort", entry.abort, { once: true }); }
  });
}

function wavInfo(wav: Uint8Array) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (offset: number, count: number) => String.fromCharCode(...wav.subarray(offset, offset + count));
  if (wav.length < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") throw new Error("Invalid WAV");
  let channels = 0, sampleRate = 0, blockAlign = 0, dataSize = 0, format = 0, bits = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = ascii(offset, 4), size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > wav.length) throw new Error("Invalid WAV chunk");
    if (id === "fmt ") {
      if (size < 16) throw new Error("Invalid WAV format");
      format = view.getUint16(start, true); channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true); blockAlign = view.getUint16(start + 12, true); bits = view.getUint16(start + 14, true);
    }
    if (id === "data") dataSize = size;
    offset = start + size + size % 2;
  }
  if (![1, 2].includes(channels) || ![1, 3].includes(format) || ![16, 24, 32].includes(bits) || (format === 3 && bits !== 32) || sampleRate < 8000 || sampleRate > 192000 || blockAlign !== channels * bits / 8 || !dataSize || dataSize % blockAlign) throw new Error("Unsupported WAV");
  return { channels, sampleRate, frames: dataSize / blockAlign, duration: dataSize / blockAlign / sampleRate };
}

function validateInput(input: RenderSpatialClipInput) {
  const result = PositionSchema.strict().safeParse(input.position);
  if (!result.success) throw new SpatialAudioError("声音位置参数无效。", 400);
  for (const [value, positive] of [[input.durationSeconds, true], [input.fadeInSeconds, false], [input.fadeOutSeconds, false]] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || (positive && value < 1 / 48000) || value > MAX_SPATIAL_DURATION_SECONDS)) throw new SpatialAudioError("空间处理时长或淡入淡出参数无效（最长 10 分钟）。", 400);
  }
  return { position: result.data, durationSeconds: input.durationSeconds, fadeInSeconds: input.fadeInSeconds ?? 0, fadeOutSeconds: input.fadeOutSeconds ?? 0 };
}

async function findScriptPath(override?: string) {
  if (override) return path.resolve(override);
  const candidates = [path.resolve("scripts", "spatial_d", "render.py"), path.resolve("apps", "web", "scripts", "spatial_d", "render.py")];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* Try the repository-root layout. */ } }
  throw new SpatialAudioError("空间处理程序缺失，请检查本机安装。", 503);
}
async function fileHash(filePath: string) { return createHash("sha256").update(await readFile(filePath)).digest("hex"); }
async function codeHash(scriptPath: string) {
  const directory = path.dirname(scriptPath);
  const names = (await readdir(directory)).filter(name => name.endsWith(".py")).sort();
  const hash = createHash("sha256");
  for (const name of names) { hash.update(name); hash.update(await readFile(path.join(directory, name))); }
  return hash.digest("hex");
}
function validateOutput(wav: Uint8Array, sourceDuration: number) {
  const info = wavInfo(wav);
  // Original D keeps the full 650 ms convolution response, including its final sample.
  if (info.channels !== 2 || info.sampleRate !== 48000 || Math.abs(info.duration - sourceDuration - .65) > 3 / 48000) throw new Error("Invalid spatial output length or format");
}

function waitForRenderer(child: SpatialChild, signal: AbortSignal | undefined, timeoutMs: number, exitWaitMs: number, onExit: () => void) {
  return new Promise<void>((resolve, reject) => {
    let settled = false, stopping: SpatialAudioError | undefined, log = "";
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const capture = (chunk: Buffer | string) => { log = (log + chunk.toString()).slice(-8192); };
    child.stdout?.on("data", capture); child.stderr?.on("data", capture);
    const finish = (error?: SpatialAudioError) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(exitTimer); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const stop = (error: SpatialAudioError) => {
      if (settled || stopping) return;
      stopping = error;
      exitTimer = setTimeout(() => finish(new SpatialAudioError("空间处理进程尚未停止，请稍后再试。", 503)), exitWaitMs);
      try { child.kill("SIGKILL"); } catch { /* Keep the render slot until process exit is confirmed. */ }
    };
    const abort = () => stop(cancelled());
    const timer = setTimeout(() => stop(new SpatialAudioError("空间处理超时，请缩短片段后重试。", 504)), timeoutMs);
    child.once("error", () => {
      if (!child.pid) { onExit(); finish(new SpatialAudioError("空间处理无法启动，请检查 Python 运行环境。", 503)); }
      else stop(new SpatialAudioError("空间处理进程异常，请重试。"));
    });
    child.once("close", code => {
      onExit();
      const missingDependency = /ModuleNotFoundError|ImportError|No module named/.test(log);
      finish(stopping ?? (code === 0 ? undefined : new SpatialAudioError(missingDependency ? "空间处理缺少 Python 依赖，请安装 numpy、scipy、soundfile、h5py 与 pyloudnorm。" : "空间处理失败，请检查本机运行环境与 HRTF 文件。", missingDependency ? 503 : 500)));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function renderSpatialClip(input: RenderSpatialClipInput, dependencies: Dependencies = {}): Promise<SpatialClipResult> {
  const { config, signal } = input;
  checkCancelled(signal);
  const parameters = validateInput(input);
  let inputPath: string;
  try { inputPath = resolveClipAssetPath(input.assetId, config); }
  catch { throw new SpatialAudioError("音频素材编号无效。", 400); }
  let source: Buffer;
  try {
    const info = await stat(inputPath);
    if (!info.isFile() || info.size > MAX_INPUT_BYTES) throw new SpatialAudioError("人声音频过大（最长 10 分钟）。", 413);
    source = await readFile(inputPath, { signal });
  } catch (error) { checkCancelled(signal); if (error instanceof SpatialAudioError) throw error; throw new SpatialAudioError("找不到原始人声音频。", 404); }
  let sourceInfo: ReturnType<typeof wavInfo>;
  try { sourceInfo = wavInfo(source); } catch { throw new SpatialAudioError("原始素材需要有效的单声道或立体声 PCM WAV。", 422); }
  if (sourceInfo.duration > MAX_SPATIAL_DURATION_SECONDS) throw new SpatialAudioError("空间处理暂支持最长 10 分钟的人声片段。", 413);
  checkCancelled(signal);
  if (sourceInfo.channels === 2) return { wav: new Uint8Array(source), spatialized: false };
  if (![32000, 44100, 48000].includes(sourceInfo.sampleRate)) throw new SpatialAudioError("空间处理的人声采样率需要为 32、44.1 或 48 kHz。", 422);

  const cacheRoot = path.resolve(config.spatialCacheRoot ?? path.join(config.runtimeRoot, "assets", "spatial"));
  const pythonPath = config.spatialPythonPath ?? path.join(config.runtimeRoot, "audio-quality-v1", ".venv", "Scripts", "python.exe");
  const hrtfPath = path.resolve(config.spatialHrtfPath ?? path.join(config.runtimeRoot, "audio-quality-v1", "hrtf", "viking", "subj_A.sofa"));
  const scriptPath = await findScriptPath(dependencies.scriptPath);
  let hrtfIdentity: string, rendererIdentity: string;
  try { [hrtfIdentity, rendererIdentity] = await Promise.all([fileHash(hrtfPath), codeHash(scriptPath)]); }
  catch { throw new SpatialAudioError("空间处理的 HRTF 或程序文件缺失，请检查本机配置。", 503); }
  const cacheKey = createHash("sha256").update(JSON.stringify({ version: SPATIAL_RENDER_VERSION, source: createHash("sha256").update(source).digest("hex"), hrtfIdentity, rendererIdentity, preprocess: "listening", ...parameters })).digest("hex");
  const cachePath = path.join(cacheRoot, `${cacheKey}.wav`);
  const sourceDuration = Math.min(sourceInfo.duration, parameters.durationSeconds ?? sourceInfo.duration);
  const readCached = async (): Promise<SpatialClipResult | undefined> => {
    try {
      if ((await stat(cachePath)).size > MAX_OUTPUT_BYTES) return undefined;
      const wav = await readFile(cachePath, { signal }); validateOutput(wav, sourceDuration); checkCancelled(signal);
      return { wav: new Uint8Array(wav), spatialized: true };
    } catch { checkCancelled(signal); return undefined; }
  };
  const cached = await readCached(); if (cached) return cached;
  checkCancelled(signal);
  const release = await acquireRender(signal);
  let temporaryRoot: string | undefined, confirmedExit = true, cleanupOnExit = false;
  const cleanup = async () => { if (temporaryRoot?.startsWith(cacheRoot + path.sep)) await rm(temporaryRoot, { recursive: true, force: true }).catch(() => {}); };
  try {
    checkCancelled(signal);
    const queuedCache = await readCached(); if (queuedCache) return queuedCache;
    try { await access(pythonPath); } catch { throw new SpatialAudioError("空间处理 Python 不可用，请配置 ASMR_SPATIAL_PYTHON。", 503); }
    await mkdir(cacheRoot, { recursive: true });
    temporaryRoot = await mkdtemp(path.join(cacheRoot, "render-"));
    const requestPath = path.join(temporaryRoot, "request.json"), outputPath = path.join(temporaryRoot, "output.wav"), reportPath = path.join(temporaryRoot, "output.json"), snapshotPath = path.join(temporaryRoot, "input.wav");
    await writeFile(snapshotPath, source, { signal });
    await writeFile(requestPath, JSON.stringify({ version: 1, inputWav: snapshotPath, outputWav: outputPath, outputJson: reportPath, hrtfPath, preprocess: "listening", ...parameters }), { signal });
    checkCancelled(signal);
    const spawnImpl: SpatialSpawn = dependencies.spawnImpl ?? ((command, args, options) => spawn(command, [...args], options));
    const child = spawnImpl(pythonPath, ["-B", scriptPath, "--request", requestPath], {
      cwd: path.dirname(scriptPath), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      // Keep dependency scratch files on the configured cache volume too, even
      // when the long-lived Next process inherited a different system temp path.
      env: { ...process.env, TEMP: temporaryRoot, TMP: temporaryRoot, TMPDIR: temporaryRoot },
    });
    confirmedExit = false;
    await waitForRenderer(child, signal, dependencies.timeoutMs ?? 300_000, dependencies.exitWaitMs ?? 5_000, () => {
      confirmedExit = true;
      if (cleanupOnExit) { release(); void cleanup(); }
    });
    checkCancelled(signal);
    let output: Buffer;
    try {
      if ((await stat(outputPath)).size > MAX_OUTPUT_BYTES || (await stat(reportPath)).size > 1024 * 1024) throw new Error("Output too large");
      output = await readFile(outputPath, { signal });
      const report = JSON.parse(await readFile(reportPath, { encoding: "utf8", signal }));
      validateOutput(output, sourceDuration);
      if (report.version !== 1 || report.spatialized !== true || report.sampleRate !== 48000 || report.channels !== 2 || !Number.isFinite(report.sourceDurationSeconds) || Math.abs(report.sourceDurationSeconds - sourceDuration) > 3 / 48000 || !Number.isFinite(report.outputDurationSeconds) || Math.abs(report.outputDurationSeconds - wavInfo(output).duration) > 1 / 48000 || !Number.isFinite(report.tailSeconds) || Math.abs(report.tailSeconds - .65) > 3 / 48000) throw new Error("Invalid spatial output report");
    } catch { checkCancelled(signal); throw new SpatialAudioError("空间处理没有产生完整有效的音频，请重试。", 502); }
    const [completedHrtfIdentity, completedRendererIdentity] = await Promise.all([fileHash(hrtfPath), codeHash(scriptPath)]);
    if (completedHrtfIdentity !== hrtfIdentity || completedRendererIdentity !== rendererIdentity) throw new SpatialAudioError("空间处理程序刚刚更新，请重新试听。", 409);
    checkCancelled(signal);
    // Publish only a validated complete WAV; the original clip asset is never overwritten.
    await rename(outputPath, cachePath);
    checkCancelled(signal);
    return { wav: new Uint8Array(output), spatialized: true };
  } catch (error) {
    checkCancelled(signal);
    if (error instanceof SpatialAudioError) throw error;
    throw new SpatialAudioError("空间处理无法完成，请检查本地缓存空间与运行环境。", 500);
  } finally {
    if (confirmedExit) { release(); await cleanup(); }
    else cleanupOnExit = true;
  }
}
