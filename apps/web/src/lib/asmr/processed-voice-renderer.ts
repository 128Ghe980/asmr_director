import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAudioPostProcessingSettingsFingerprint } from "./audio-post-processing";
import { resolveClipAssetPath, saveClipAsset } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";

export const PROCESSED_VOICE_RENDERER_VERSION = "processed-voice-v1";
const RATE = 48000, MAX_SECONDS = 600, MAX_INPUT = 128 * 1024 * 1024, MAX_OUTPUT = 192 * 1024 * 1024;
const DISTANCES = ["far", "mid", "near", "close", "very_close"] as const;
const MOVEMENTS = ["static", "approach", "recede", "left_to_right", "right_to_left", "orbit", "orbit_approach"] as const;
export type ProcessedVoiceAnchor = { pan: number; distance: typeof DISTANCES[number] };
export type RenderProcessedVoiceInput = {
  clipId: string; sourceAssetId: string; start: ProcessedVoiceAnchor; end: ProcessedVoiceAnchor;
  movement: typeof MOVEMENTS[number]; volumeDb: number; fadeInSeconds: number; fadeOutSeconds: number;
  binaural: boolean; config: LocalRuntimeConfig; signal?: AbortSignal;
};
export type ProcessedVoiceRenderResult = {
  asset: { assetId: string; uri: string; duration: number };
  sourceSha256: string; outputSha256: string; settingsFingerprint: string; rendererVersion: string; cacheHit?: boolean;
};
export class ProcessedVoiceRenderError extends Error {
  constructor(message: string, public readonly statusCode = 500) { super(message); this.name = "ProcessedVoiceRenderError"; }
}
type Child = {
  pid?: number; stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal: NodeJS.Signals): unknown;
};
export type ProcessedVoiceSpawn = (command: string, args: readonly string[], options: {
  cwd: string; shell: false; windowsHide: true; stdio: ["ignore", "pipe", "pipe"]; env: NodeJS.ProcessEnv;
}) => Child;
type Dependencies = { scriptPath?: string; spawnImpl?: ProcessedVoiceSpawn; timeoutMs?: number; exitWaitMs?: number; now?: Date };
type WavInfo = { sampleRate: number; channels: number; frames: number; duration: number };
type Settings = Pick<RenderProcessedVoiceInput, "start" | "end" | "movement" | "volumeDb" | "fadeInSeconds" | "fadeOutSeconds" | "binaural">;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const cancelled = () => new ProcessedVoiceRenderError("已取消声音后处理。", 499);
function check(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }

function validate(input: RenderProcessedVoiceInput): Settings {
  const finite = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  const anchor = (value: ProcessedVoiceAnchor) => value && Object.keys(value).sort().join(",") === "distance,pan"
    && finite(value.pan, -1, 1) && DISTANCES.includes(value.distance);
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.clipId) || !/^[A-Za-z0-9_-]{1,200}$/.test(input.sourceAssetId)
    || !anchor(input.start) || !anchor(input.end) || !MOVEMENTS.includes(input.movement) || typeof input.binaural !== "boolean"
    || !finite(input.volumeDb, -80, 12) || !finite(input.fadeInSeconds, 0, MAX_SECONDS) || !finite(input.fadeOutSeconds, 0, MAX_SECONDS)) {
    throw new ProcessedVoiceRenderError("声音后处理参数无效。", 422);
  }
  const end = input.movement === "static" ? input.start : input.end;
  return { start: { pan: input.start.pan, distance: input.start.distance }, end: { pan: end.pan, distance: end.distance },
    movement: input.movement, volumeDb: input.volumeDb, fadeInSeconds: input.fadeInSeconds,
    fadeOutSeconds: input.fadeOutSeconds, binaural: input.binaural };
}

/** Header-only validation plus a streaming digest; no giant read solely to hash input. */
async function inspectFile(filePath: string, maximum: number, maxDuration: number, signal?: AbortSignal) {
  check(signal);
  const file = await open(filePath, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 44 || before.size > maximum) throw new Error("Invalid WAV size");
    const read = async (length: number, offset: number) => {
      const buffer = Buffer.alloc(length);
      if ((await file.read(buffer, 0, length, offset)).bytesRead !== length) throw new Error("Incomplete WAV");
      return buffer;
    };
    const header = await read(12, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE" || header.readUInt32LE(4) + 8 !== before.size) throw new Error("Invalid WAV header");
    let channels = 0, sampleRate = 0, blockAlign = 0, dataSize = 0, formatSeen = false, dataSeen = false;
    for (let offset = 12; offset + 8 <= before.size;) {
      check(signal);
      const chunk = await read(8, offset), id = chunk.toString("ascii", 0, 4), size = chunk.readUInt32LE(4), start = offset + 8;
      if (start + size > before.size) throw new Error("Invalid WAV chunk");
      if (id === "fmt ") {
        if (formatSeen || size < 16) throw new Error("Invalid WAV format");
        const format = await read(16, start), encoding = format.readUInt16LE(0), bits = format.readUInt16LE(14);
        channels = format.readUInt16LE(2); sampleRate = format.readUInt32LE(4); blockAlign = format.readUInt16LE(12);
        if (![1, 2].includes(channels) || ![32000, 44100, 48000].includes(sampleRate)
          || !([1, 3].includes(encoding)) || ![16, 24, 32].includes(bits) || (encoding === 3 && bits !== 32)
          || blockAlign !== channels * bits / 8 || format.readUInt32LE(8) !== sampleRate * blockAlign) throw new Error("Unsupported WAV");
        formatSeen = true;
      }
      if (id === "data") { if (dataSeen) throw new Error("Duplicate data"); dataSize = size; dataSeen = true; }
      offset = start + size + size % 2;
      if (offset > before.size) throw new Error("Invalid WAV padding");
    }
    if (!formatSeen || !dataSeen || !dataSize || dataSize % blockAlign) throw new Error("Incomplete WAV metadata");
    const frames = dataSize / blockAlign, duration = frames / sampleRate;
    if (!(duration > 0) || duration > maxDuration) throw new Error("WAV too long");
    const digest = createHash("sha256");
    for await (const chunk of file.createReadStream({ start: 0, end: before.size - 1, autoClose: false, signal })) { check(signal); digest.update(chunk); }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.dev !== after.dev) throw new Error("Source changed");
    return { info: { sampleRate, channels, frames, duration } as WavInfo, sha256: digest.digest("hex") };
  } finally { await file.close(); }
}
async function boundedAsset(assetId: string, config: LocalRuntimeConfig, maximum: number, maxDuration: number, signal?: AbortSignal) {
  const location = resolveClipAssetPath(assetId, config);
  const [root, target] = await Promise.all([realpath(config.clipAssetRoot), realpath(location)]);
  if (!target.startsWith(root + path.sep)) throw new Error("Asset outside root");
  return { filePath: target, ...await inspectFile(target, maximum, maxDuration, signal) };
}
export async function inspectProcessedVoiceSource(input: { sourceAssetId: string; config: LocalRuntimeConfig; signal?: AbortSignal }): Promise<{ sourceSha256: string; durationSeconds: number }> {
  check(input.signal);
  try {
    const source = await boundedAsset(input.sourceAssetId, input.config, MAX_INPUT, MAX_SECONDS, input.signal);
    return { sourceSha256: source.sha256, durationSeconds: source.info.duration };
  } catch {
    check(input.signal);
    throw new ProcessedVoiceRenderError("原始人声音频不存在、格式无效或超出 10 分钟限制。", 422);
  }
}
async function fileHash(filePath: string) {
  const file = await open(filePath, "r");
  try { const digest = createHash("sha256"); for await (const chunk of file.createReadStream({ autoClose: false })) digest.update(chunk); return digest.digest("hex"); }
  finally { await file.close(); }
}
async function codeHash(scriptPath: string) {
  const directory = path.dirname(scriptPath), digest = createHash("sha256");
  for (const name of [path.basename(scriptPath), "spatial_d/__init__.py", "spatial_d/core.py", "spatial_d/near_field.py", "spatial_d/motion_convolution.py"]) {
    digest.update(name); digest.update(await fileHash(path.join(directory, name)));
  }
  return digest.digest("hex");
}
async function findScript(override?: string) {
  if (override) return path.resolve(override);
  for (const candidate of [path.resolve("scripts/render-processed-voice.py"), path.resolve("apps/web/scripts/render-processed-voice.py")]) {
    try { await access(candidate); return candidate; } catch { /* Try repository root. */ }
  }
  throw new ProcessedVoiceRenderError("声音后处理程序缺失。", 503);
}

type QueueEntry = { signal?: AbortSignal; abort: () => void; resolve: (release: () => void) => void; reject: (error: Error) => void };
// Match the legacy queue's shape and key so old/new server bundles cannot render concurrently.
const shared = globalThis as typeof globalThis & { __asmrSpatialQueue?: { entries: QueueEntry[]; active: boolean } };
const queueState = shared.__asmrSpatialQueue ??= { entries: [], active: false };
function grant(entry: QueueEntry) {
  queueState.active = true; entry.signal?.removeEventListener("abort", entry.abort);
  let released = false;
  entry.resolve(() => { if (released) return; released = true; queueState.active = false; const next = queueState.entries.shift(); if (next) grant(next); });
}
function acquire(signal?: AbortSignal): Promise<() => void> {
  check(signal);
  if (queueState.active && queueState.entries.length >= 8) throw new ProcessedVoiceRenderError("声音后处理任务较多，请稍后再试。", 429);
  return new Promise((resolve, reject) => {
    const entry: QueueEntry = { signal, resolve, reject, abort: () => {
      const index = queueState.entries.indexOf(entry); if (index >= 0) queueState.entries.splice(index, 1); reject(cancelled());
    } };
    if (!queueState.active) grant(entry); else { queueState.entries.push(entry); signal?.addEventListener("abort", entry.abort, { once: true }); }
  });
}
function waitForChild(child: Child, signal: AbortSignal | undefined, timeoutMs: number, exitWaitMs: number, exited: () => void) {
  return new Promise<void>((resolve, reject) => {
    let settled = false, stopping: ProcessedVoiceRenderError | undefined, log = "";
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const capture = (chunk: Buffer | string) => { log = (log + chunk.toString()).slice(-8192); };
    child.stdout?.on("data", capture); child.stderr?.on("data", capture);
    const finish = (error?: ProcessedVoiceRenderError) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(exitTimer); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const stop = (error: ProcessedVoiceRenderError) => {
      if (settled || stopping) return; stopping = error;
      exitTimer = setTimeout(() => finish(new ProcessedVoiceRenderError("声音处理进程尚未退出，请稍后再试。", 503)), exitWaitMs);
      try { child.kill("SIGKILL"); } catch { /* The shared gate stays held until actual close. */ }
    };
    const abort = () => stop(cancelled());
    const timer = setTimeout(() => stop(new ProcessedVoiceRenderError("声音后处理超时。", 504)), timeoutMs);
    child.once("error", () => {
      if (!child.pid) { exited(); finish(new ProcessedVoiceRenderError("声音后处理无法启动，请检查 Python。", 503)); }
      else stop(new ProcessedVoiceRenderError("声音后处理进程异常。"));
    });
    child.once("close", code => {
      exited();
      const missing = /ModuleNotFoundError|ImportError|No module named/.test(log);
      finish(stopping ?? (code === 0 ? undefined : new ProcessedVoiceRenderError(missing ? "声音后处理缺少已有 Python 依赖。" : "声音后处理失败，请检查运行环境与 HRTF。", missing ? 503 : 500)));
    });
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  });
}

/** Explicit action only. Ordinary asset GET and candidate playback never call this function. */
export async function renderProcessedVoice(input: RenderProcessedVoiceInput, dependencies: Dependencies = {}): Promise<ProcessedVoiceRenderResult> {
  check(input.signal);
  const options = validate(input), { config, signal } = input;
  const settingsFingerprint = createAudioPostProcessingSettingsFingerprint({ clipId: input.clipId, sourceAssetId: input.sourceAssetId, ...options });
  let source: Awaited<ReturnType<typeof boundedAsset>>;
  try { source = await boundedAsset(input.sourceAssetId, config, MAX_INPUT, MAX_SECONDS, signal); }
  catch { check(signal); throw new ProcessedVoiceRenderError("原始人声音频不存在、格式无效或超出 10 分钟限制。", 422); }
  const scriptPath = await findScript(dependencies.scriptPath);
  const pythonPath = config.spatialPythonPath ?? path.join(config.runtimeRoot, "audio-quality-v1/.venv/Scripts/python.exe");
  const hrtfPath = path.resolve(config.spatialHrtfPath ?? path.join(config.runtimeRoot, "audio-quality-v1/hrtf/viking/subj_A.sofa"));
  const spatialized = options.binaural && source.info.channels === 1;
  let rendererIdentity: string, hrtfIdentity: string | null;
  try { [rendererIdentity, hrtfIdentity] = await Promise.all([codeHash(scriptPath), spatialized ? fileHash(hrtfPath) : Promise.resolve(null)]); }
  catch { throw new ProcessedVoiceRenderError("声音后处理程序或 HRTF 文件缺失。", 503); }
  const identity = hash(JSON.stringify({ rendererVersion: PROCESSED_VOICE_RENDERER_VERSION, sourceSha256: source.sha256, settingsFingerprint, rendererIdentity, hrtfIdentity }));
  const cacheRoot = path.resolve(config.spatialCacheRoot ?? path.join(config.runtimeRoot, "assets/spatial"), "processed-voice");
  await mkdir(cacheRoot, { recursive: true });
  const receiptPath = path.join(cacheRoot, identity + ".json");
  const sourceFrames = Math.ceil(source.info.frames * RATE / source.info.sampleRate);
  const expectedFrames = sourceFrames + (spatialized ? Math.round(.65 * RATE) : 0);
  const validateOutput = (info: WavInfo) => info.channels === 2 && info.sampleRate === RATE && Math.abs(info.frames - expectedFrames) <= 3;
  const ensureCurrent = async () => {
    try {
      const [currentSource, currentCode, currentHrtf] = await Promise.all([
        boundedAsset(input.sourceAssetId, config, MAX_INPUT, MAX_SECONDS, signal), codeHash(scriptPath), spatialized ? fileHash(hrtfPath) : Promise.resolve(null),
      ]);
      if (currentSource.sha256 !== source.sha256 || currentCode !== rendererIdentity || currentHrtf !== hrtfIdentity) throw new Error("Render inputs changed");
    } catch { check(signal); throw new ProcessedVoiceRenderError("原音、HRTF 或处理程序已变化，请重新处理。", 409); }
  };
  const cached = async (): Promise<ProcessedVoiceRenderResult | undefined> => {
    try {
      const [resolvedRoot, resolvedReceipt] = await Promise.all([realpath(cacheRoot), realpath(receiptPath)]);
      if (!resolvedReceipt.startsWith(resolvedRoot + path.sep) || (await stat(resolvedReceipt)).size > 65536) return;
      const receipt = JSON.parse(await readFile(resolvedReceipt, { encoding: "utf8", signal }));
      if (receipt.identity !== identity || receipt.rendererVersion !== PROCESSED_VOICE_RENDERER_VERSION || receipt.sourceSha256 !== source.sha256
        || receipt.settingsFingerprint !== settingsFingerprint || !receipt.asset || typeof receipt.asset.assetId !== "string"
        || !/^[A-Za-z0-9_-]{1,200}$/.test(receipt.asset.assetId) || receipt.asset.assetId === input.sourceAssetId
        || !Number.isFinite(receipt.asset.duration) || receipt.asset.duration <= 0
        || receipt.asset.uri !== `asset://clip/${receipt.asset.assetId}` || !/^[a-f0-9]{64}$/.test(receipt.outputSha256)) return;
      const output = await boundedAsset(receipt.asset.assetId, config, MAX_OUTPUT, MAX_SECONDS + .65 + 3 / RATE, signal);
      if (output.sha256 !== receipt.outputSha256 || !validateOutput(output.info) || Math.abs(receipt.asset.duration - output.info.duration) > 1 / RATE) return;
      await ensureCurrent();
      check(signal);
      return { asset: { assetId: receipt.asset.assetId, uri: receipt.asset.uri, duration: output.info.duration }, sourceSha256: source.sha256,
        outputSha256: output.sha256, settingsFingerprint, rendererVersion: PROCESSED_VOICE_RENDERER_VERSION, cacheHit: true };
    } catch (error) { check(signal); if (error instanceof ProcessedVoiceRenderError) throw error; return; }
  };
  const hit = await cached(); if (hit) return hit;
  const release = await acquire(signal);
  let work: string | undefined, confirmedExit = true, cleanupOnExit = false;
  const cleanup = async () => { if (work?.startsWith(cacheRoot + path.sep)) await rm(work, { recursive: true, force: true }).catch(() => undefined); };
  try {
    check(signal);
    const queuedHit = await cached(); if (queuedHit) return queuedHit;
    try { await access(pythonPath); } catch { throw new ProcessedVoiceRenderError("声音后处理 Python 不可用。", 503); }
    work = await mkdtemp(path.join(cacheRoot, "render-"));
    const requestPath = path.join(work, "request.json"), snapshotPath = path.join(work, "input.wav"), outputPath = path.join(work, "output.wav"), reportPath = path.join(work, "output.json");
    await copyFile(source.filePath, snapshotPath);
    const snapshot = await inspectFile(snapshotPath, MAX_INPUT, MAX_SECONDS, signal);
    if (snapshot.sha256 !== source.sha256) throw new ProcessedVoiceRenderError("原始音频已变化，请重新处理。", 409);
    await writeFile(requestPath, JSON.stringify({ version: 1, inputWav: snapshotPath, outputWav: outputPath, outputJson: reportPath,
      sourceSha256: source.sha256, ...(spatialized ? { hrtfPath } : {}), ...options }), { flag: "wx", signal });
    check(signal);
    const spawnImpl: ProcessedVoiceSpawn = dependencies.spawnImpl ?? ((command, args, options) => spawn(command, [...args], options));
    const child = spawnImpl(pythonPath, ["-B", scriptPath, "--request", requestPath], {
      cwd: path.dirname(scriptPath), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", TEMP: work, TMP: work, TMPDIR: work },
    });
    confirmedExit = false;
    await waitForChild(child, signal, dependencies.timeoutMs ?? 300_000, dependencies.exitWaitMs ?? 5_000, () => {
      confirmedExit = true; if (cleanupOnExit) { release(); void cleanup(); }
    });
    check(signal);
    let output: Buffer, outputInfo: WavInfo, outputSha: string;
    try {
      const checked = await inspectFile(outputPath, MAX_OUTPUT, MAX_SECONDS + .65 + 3 / RATE, signal);
      outputInfo = checked.info; outputSha = checked.sha256;
      if (!validateOutput(outputInfo) || (await stat(reportPath)).size > 1024 * 1024) throw new Error("Invalid output");
      const report = JSON.parse(await readFile(reportPath, { encoding: "utf8", signal }));
      if (report.version !== 1 || report.rendererVersion !== PROCESSED_VOICE_RENDERER_VERSION || report.sourceSha256 !== source.sha256
        || report.outputSha256 !== outputSha || report.spatialized !== spatialized || report.channels !== 2 || report.sampleRate !== RATE
        || report.sourceFrames !== sourceFrames || report.outputFrames !== outputInfo.frames || report.tailSeconds !== (spatialized ? .65 : 0)
        || JSON.stringify(report.settings) !== JSON.stringify(options)) throw new Error("Invalid report binding");
      output = await readFile(outputPath, { signal });
      if (hash(output) !== outputSha) throw new Error("Output changed");
    } catch { check(signal); throw new ProcessedVoiceRenderError("声音后处理未产生完整且匹配的音频。", 502); }
    await ensureCurrent();
    check(signal);
    const asset = await saveClipAsset({ config, clipId: "processed_" + hash(input.clipId).slice(0, 16), wav: output, duration: outputInfo.duration, now: dependencies.now });
    const result: ProcessedVoiceRenderResult = { asset, sourceSha256: source.sha256, outputSha256: outputSha, settingsFingerprint, rendererVersion: PROCESSED_VOICE_RENDERER_VERSION, cacheHit: false };
    const temporary = receiptPath + "." + randomUUID() + ".tmp";
    try { await writeFile(temporary, JSON.stringify({ identity, ...result }), { flag: "wx" }); await rename(temporary, receiptPath); }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
    check(signal);
    return result;
  } catch (error) {
    if (error instanceof ProcessedVoiceRenderError) throw error;
    check(signal);
    throw new ProcessedVoiceRenderError("声音后处理无法完成，请检查文件和运行环境。", 500);
  } finally {
    if (confirmedExit) { release(); await cleanup(); } else cleanupOnExit = true;
  }
}
