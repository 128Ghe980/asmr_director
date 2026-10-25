import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { getCurrentAudioPostProcessingReceipt } from "./audio-post-processing";
import { resolveClipAssetPath } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import type { AsmrProject } from "./schema";

const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

/** Read an already prepared asset. Neither playback nor export creates DSP work. */
export async function readPreparedAudioSource(project: AsmrProject, clipId: string,
  config: LocalRuntimeConfig, signal?: AbortSignal, retainOutput = true) {
  signal?.throwIfAborted();
  const receipt = getCurrentAudioPostProcessingReceipt(project, clipId);
  if (!receipt) return undefined;
  const source = project.timeline.tracks.flatMap(track => track.track_type === "voice" ? track.clips : []).find(clip => clip.id === clipId);
  if (!source?.asset.asset_id) throw new Error("后处理对应的原音不可用，请重新生成后处理。");
  const root = await realpath(config.clipAssetRoot);
  const inspect = async (assetId: string, expectedSha: string, retain: boolean, maxBytes: number) => {
    const resolved = await realpath(resolveClipAssetPath(assetId, config));
    const relative = path.relative(root, resolved);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error("后处理素材路径无效。");
    const file = await open(resolved, "r");
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size < 44 || before.size > maxBytes) throw new Error("后处理素材文件无效或过大。");
      const hash = createHash("sha256"), chunks: Buffer[] = [];
      let offset = 0;
      while (offset < before.size) {
        signal?.throwIfAborted();
        const bytes = Buffer.alloc(Math.min(1024 * 1024, before.size - offset));
        const result = await file.read(bytes, 0, bytes.length, offset);
        if (!result.bytesRead) throw new Error("后处理素材文件不完整。");
        const chunk = bytes.subarray(0, result.bytesRead);
        hash.update(chunk); if (retain) chunks.push(chunk);
        offset += result.bytesRead;
      }
      const after = await file.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || hash.digest("hex") !== expectedSha)
        throw new Error("原音或后处理文件已变化，请重新生成后处理。");
      return { filePath: resolved, size: before.size, mtimeMs: before.mtimeMs,
        ...(retain ? { wav: Buffer.concat(chunks) } : {}) };
    } finally { await file.close(); }
  };
  await inspect(source.asset.asset_id, receipt.sourceSha256, false, MAX_SOURCE_BYTES);
  const output = await inspect(receipt.asset.assetId, receipt.outputSha256, retainOutput, MAX_OUTPUT_BYTES);
  return { ...output, wav: output.wav ?? Buffer.alloc(0), asset: receipt.asset, receipt };
}
