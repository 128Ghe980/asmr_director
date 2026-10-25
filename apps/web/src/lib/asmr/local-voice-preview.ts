import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { getAcceptedVoicePreviewPlan } from "./accepted-voice-preview";
import { resolveClipAssetPath } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16Wav } from "./pcm-audio";
import type { AsmrProject } from "./schema";
import { readPreparedAudioSource } from "./prepared-audio-source";

export class VoicePreviewError extends Error {
  constructor(message: string, public readonly statusCode = 500) { super(message); this.name = "VoicePreviewError"; }
}
export type PreparedVoicePreview = {
  filePath: string; filename: string; clipCount: number; skippedCount: number; duration: number; size: number;
  cleanup: () => Promise<void>;
};
const SAMPLE_RATE = 48000;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_DURATION_SECONDS = 1200;
const MAX_CLIP_SECONDS = 600;
const DEADLINE_MS = 120000;

type SourcePcm = { view: DataView; channels: number; sampleRate: number; bytesPerSample: number; offset: number; frames: number };
function inspectPcm(bytes: Uint8Array): SourcePcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 44 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") throw new Error("Invalid WAV");
  let format = 0, channels = 0, sampleRate = 0, bits = 0, blockAlign = 0, dataOffset = 0, dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = ascii(offset), size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > bytes.length) throw new Error("Invalid WAV chunk");
    if (id === "fmt ") {
      if (size < 16) throw new Error("Invalid WAV format");
      format = view.getUint16(start, true); channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true); blockAlign = view.getUint16(start + 12, true); bits = view.getUint16(start + 14, true);
    }
    if (id === "data") { dataOffset = start; dataSize = size; }
    offset = start + size + size % 2;
  }
  if (format !== 1 || ![1, 2].includes(channels) || ![16, 24].includes(bits) || sampleRate < 8000 || sampleRate > 192000
    || blockAlign !== channels * bits / 8 || !dataSize || dataSize % blockAlign) throw new Error("Unsupported WAV");
  return { view, channels, sampleRate, bytesPerSample: bits / 8, offset: dataOffset, frames: dataSize / blockAlign };
}
function readSample(source: SourcePcm, frame: number, channel: number) {
  const offset = source.offset + (frame * source.channels + (source.channels === 1 ? 0 : channel)) * source.bytesPerSample;
  if (source.bytesPerSample === 2) {
    const value = source.view.getInt16(offset, true);
    return value / (value < 0 ? 32768 : 32767);
  }
  return (source.view.getUint8(offset) | source.view.getUint8(offset + 1) << 8 | source.view.getInt8(offset + 2) << 16) / 8388608;
}

/** Stream PCM chunks, keeping memory bounded to one adopted source rather than the complete output. */
export async function prepareVoicePreview(project: AsmrProject, config: LocalRuntimeConfig, signal?: AbortSignal,
  dependencies: { tempRoot?: string; deadlineMs?: number; maxDurationSeconds?: number; audioVersion?: "original" | "processed" } = {}): Promise<PreparedVoicePreview> {
  const workSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(dependencies.deadlineMs ?? DEADLINE_MS)]);
  const check = () => {
    if (workSignal.aborted) throw new VoicePreviewError(signal?.aborted ? "已取消整体预览。" : "整体预览整理超时，请减少片段后重试。", signal?.aborted ? 499 : 408);
  };
  check();
  const processed = dependencies.audioVersion === "processed";
  const plan = getAcceptedVoicePreviewPlan(project, dependencies.audioVersion);
  if (processed && (plan.skippedCount > 0 || !plan.clipCount)) throw new VoicePreviewError("请先完成当前全部语音的后处理，再试听整批结果。", 422);
  if (!plan.entries.length) throw new VoicePreviewError("当前工程还没有已采用的语音。", 400);
  if (plan.entries.length > 2000) throw new VoicePreviewError("预览最多支持 2000 段。", 413);
  for (const track of project.timeline.tracks) if (track.track_type === "voice") for (const clip of track.clips) {
    if (clip.kind !== "silent" && clip.generation.status === "asset_generated" && clip.asset.uri?.startsWith("asset://clip/")
      && clip.asset.uri !== `asset://clip/${clip.asset.asset_id}`) throw new VoicePreviewError("已采用语音的素材引用不一致。", 400);
  }
  const tempRoot = path.resolve(dependencies.tempRoot ?? process.env.ASMR_VOICE_PREVIEW_TEMP_ROOT
    ?? path.join(config.spatialCacheRoot ?? path.join(config.runtimeRoot, "assets", "spatial"), "voice-previews"));
  await mkdir(tempRoot, { recursive: true });
  const directory = await mkdtemp(path.join(tempRoot, "preview-"));
  const filePath = path.join(directory, "preview.wav");
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => cleanupPromise ??= directory.startsWith(tempRoot + path.sep)
    ? rm(directory, { recursive: true, force: true }) : Promise.reject(new Error("Invalid preview temporary directory"));
  let file: FileHandle | undefined, prepared = false, outputFrames = 0;
  try {
    file = await open(filePath, "wx");
    await file.write(writePcm16Wav(new Float32Array(), SAMPLE_RATE, 2));
    for (const entry of plan.entries) {
      check();
      let source: SourcePcm | undefined;
      if ("assetId" in entry) {
      let bytes: Buffer;
      if (processed) {
        try {
          const prepared = await readPreparedAudioSource(project, entry.clipId, config, workSignal);
          if (!prepared || prepared.asset.assetId !== entry.assetId) throw new Error("后处理已更新，请重新整理试听。");
          bytes = prepared.wav;
        } catch (error) {
          check();
          throw new VoicePreviewError(error instanceof Error ? error.message : "后处理文件不可用，请重新生成后处理。", 422);
        }
      } else {
      let sourcePath: string;
      try { sourcePath = resolveClipAssetPath(entry.assetId, config); }
      catch { throw new VoicePreviewError("已采用语音的素材编号无效。", 400); }
      try {
        const [root, source, info] = await Promise.all([realpath(config.clipAssetRoot), realpath(sourcePath), stat(sourcePath)]);
        if (!source.startsWith(root + path.sep)) throw new VoicePreviewError("已采用语音的素材路径无效。", 400);
        if (!info.isFile()) throw new VoicePreviewError("已采用的语音文件不可用。", 404);
        if (info.size > MAX_SOURCE_BYTES) throw new VoicePreviewError("单段语音过大（上限 128 MiB）。", 413);
        bytes = await readFile(source, { signal: workSignal });
        if (bytes.length !== info.size) throw new VoicePreviewError("语音文件在读取时发生变化，请重试。", 409);
      } catch (error) {
        check();
        if (error instanceof VoicePreviewError) throw error;
        throw new VoicePreviewError("找不到已采用的语音文件，请检查本地素材。", 404);
      }
      }
      try { source = inspectPcm(bytes); }
      catch { throw new VoicePreviewError("已采用的素材需要有效的 PCM WAV 语音。", 422); }
      if (source.frames / source.sampleRate > MAX_CLIP_SECONDS + (processed ? .65 + 1 / 48000 : 0)) throw new VoicePreviewError("每段语音最长支持 10 分钟。", 413);
      } else if (entry.silenceDurationSeconds > MAX_CLIP_SECONDS) throw new VoicePreviewError("无对白镜头最长支持 10 分钟。", 413);
      const frames = Math.max(1, Math.round(source ? source.frames * SAMPLE_RATE / source.sampleRate
        : "silenceDurationSeconds" in entry ? entry.silenceDurationSeconds * SAMPLE_RATE : 0));
      const gapFrames = Math.round(entry.gapAfterSeconds * SAMPLE_RATE);
      const nextFrames = outputFrames + frames + gapFrames;
      if (!Number.isSafeInteger(nextFrames) || nextFrames > (dependencies.maxDurationSeconds ?? MAX_DURATION_SECONDS) * SAMPLE_RATE)
        throw new VoicePreviewError("整体预览过长，请分工程预览（最长 20 分钟）。", 413);
      for (let frame = 0; frame < frames + gapFrames;) {
        check();
        const length = Math.min(4096, frames + gapFrames - frame), chunk = new Uint8Array(length * 4), view = new DataView(chunk.buffer);
        for (let index = 0; index < length; index++) {
          const targetFrame = frame + index;
          if (targetFrame >= frames || !source) continue;
          const position = targetFrame * source.sampleRate / SAMPLE_RATE;
          const before = Math.min(Math.floor(position), source.frames - 1), after = Math.min(before + 1, source.frames - 1), fraction = position - before;
          for (let channel = 0; channel < 2; channel++) {
            const left = readSample(source, before, channel), right = readSample(source, after, channel);
            const sample = Math.max(-1, Math.min(1, left + (right - left) * fraction));
            view.setInt16(index * 4 + channel * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
          }
        }
        let written = 0;
        while (written < chunk.length) { check(); written += (await file.write(chunk, written, chunk.length - written)).bytesWritten; }
        frame += length;
      }
      outputFrames = nextFrames;
    }
    check();
    const header = writePcm16Wav(new Float32Array(), SAMPLE_RATE, 2), headerView = new DataView(header.buffer);
    headerView.setUint32(4, 36 + outputFrames * 4, true); headerView.setUint32(40, outputFrames * 4, true);
    await file.write(header, 0, header.length, 0);
    await file.close(); file = undefined;
    check();
    prepared = true;
    return { filePath, filename: plan.filename, clipCount: plan.clipCount, skippedCount: plan.skippedCount,
      duration: outputFrames / SAMPLE_RATE, size: 44 + outputFrames * 4, cleanup };
  } catch (error) {
    check();
    if (error instanceof VoicePreviewError) throw error;
    throw new VoicePreviewError("语音预览整理失败，请检查素材和缓存空间后重试。", 500);
  } finally {
    await file?.close().catch(() => {});
    if (!prepared) await cleanup().catch(() => {});
  }
}
