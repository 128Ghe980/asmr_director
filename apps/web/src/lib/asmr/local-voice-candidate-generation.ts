import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, getVoiceCandidateRequestFingerprint } from "./audio-candidate";
import { ensureAudioCandidateCapacity, getAudioCandidate, saveAudioCandidate } from "./local-candidate-store";
import { saveClipAsset } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./project-mix-renderer";
import type { AsmrProject, TimelineClip } from "./schema";
import type { VoiceGenerationOptions, LongTextRetry } from "./voice-generation-options";
import { generateVoxCpm2, VoxCpm2Error } from "./voxcpm2-provider";
import { generateVoiceLongText, type VoiceGenerationProgress } from "./voice-longtext-generation";
import { getVoiceGenerationRoot } from "./voice-generation-recordings";
import { getVoiceGenerationContext } from "./voice-generation-context";

export async function generateLocalVoiceCandidate({ project, clip, config, voiceOptions, signal, onProgress, longTextRetry, now = new Date() }: {
  project: AsmrProject; clip: Extract<TimelineClip, { type: "voice" }>; config: LocalRuntimeConfig;
  voiceOptions: VoiceGenerationOptions; signal?: AbortSignal; now?: Date;
  onProgress?: (progress: VoiceGenerationProgress) => void;
  longTextRetry?: LongTextRetry;
}) {
  signal?.throwIfAborted();
  const context = voiceOptions.generationMode === "long_text" ? getVoiceGenerationContext(project, clip.id) : undefined;
  const sourceFingerprint = getVoiceCandidateSourceFingerprint(clip, context);
  const ownership = { config, projectId: project.project_id, clipId: clip.id, adoptedAssetId: clip.asset.asset_id ?? undefined };
  await ensureAudioCandidateCapacity(ownership);
  const retryCandidate = longTextRetry ? await getAudioCandidate({ config, candidateId: longTextRetry.candidateId }) : undefined;
  if (longTextRetry && (!retryCandidate || retryCandidate.status !== "ready" || retryCandidate.projectId !== project.project_id || retryCandidate.clipId !== clip.id ||
      retryCandidate.sourceFingerprint !== sourceFingerprint || voiceOptions.generationMode !== "long_text" ||
      retryCandidate.provenance.generationMode !== "long_text" || !retryCandidate.provenance.longText?.plan ||
      !retryCandidate.provenance.longText.groups[longTextRetry.groupIndex] || retryCandidate.provenance.voicePackId !== voiceOptions.voicePackId ||
      retryCandidate.provenance.referenceMode !== voiceOptions.referenceMode)) throw new VoxCpm2Error("原候选与当前文案或声音设置不匹配，请重新生成。", 400);
  const generateCurrentClip = async () => {
    const traceRoot = path.join(getVoiceGenerationRoot(config), "long-text", randomUUID());
    await mkdir(traceRoot, { recursive: true });
    const record = (name: string, value: unknown) => writeFile(path.join(traceRoot, name), JSON.stringify(value, null, 2), "utf8");
    await record("plan.json", { projectId: project.project_id, clipId: clip.id,
      sourceFingerprint, generationMode: "clip", createdAt: now.toISOString(),
      plan: { clauses: [clip.text] }, targets: [{ expectedText: clip.text, text: clip.text }] });
    try {
      const result = await generateVoxCpm2({ text: clip.text, voicePackId: voiceOptions.voicePackId,
        referenceMode: voiceOptions.referenceMode, config, signal, now,
        onRawOutput: async (wav) => {
          const target = path.join(traceRoot, "group-1-take-1-source.wav");
          await writeFile(`${target}.tmp`, wav);
          await rename(`${target}.tmp`, target);
        } });
      await record("group-1-take-1-source.json", result.provenance).catch(() => undefined);
      await record("group-1-take-1-analysis.json", { checkStatus: "not_checked", message: result.qualityWarnings.join(" ") || "当前片段生成，完整原音可直接试听。" }).catch(() => undefined);
      return result;
    } catch (error) {
      await record("group-1-take-1-failure.json", { stage: "generate", message: error instanceof Error ? error.message : "生成未完成" }).catch(() => undefined);
      throw error;
    }
  };
  const result = voiceOptions.generationMode === "long_text"
    ? await generateVoiceLongText({ text: clip.text, clipId: clip.id, projectId: project.project_id,
      sourceFingerprint, context, voicePackId: voiceOptions.voicePackId,
      referenceMode: voiceOptions.referenceMode, analysisProvider: voiceOptions.analysisProvider ?? "local", config, signal, onProgress,
      retryCandidate: retryCandidate ?? undefined, retryGroupIndex: longTextRetry?.groupIndex })
    : await generateCurrentClip();
  signal?.throwIfAborted();
  const wav = decodePcmWav(result.wav);
  const duration = wav.samples.length / wav.channels / wav.sampleRate;
  if (!Number.isFinite(duration) || duration <= 0 || wav.samples.length % wav.channels !== 0) {
    throw new Error("Invalid voice WAV duration");
  }
  const asset = await saveClipAsset({ config, clipId: clip.id, wav: result.wav, duration, now });
  signal?.throwIfAborted();
  const candidate = AudioCandidateSchema.parse({
    version: 1, candidateId: `vox_${randomUUID().replaceAll("-", "")}`,
    projectId: project.project_id, clipId: clip.id,
    sourceFingerprint,
    requestFingerprint: getVoiceCandidateRequestFingerprint(clip, voiceOptions, longTextRetry, context),
    asset, wav: { sampleRate: wav.sampleRate, channels: wav.channels, bitsPerSample: 16 },
    provenance: result.provenance, qualityWarnings: result.qualityWarnings,
    createdAt: now.toISOString(), status: "ready",
  });
  await saveAudioCandidate({ config, candidate, adoptedAssetId: ownership.adoptedAssetId, signal });
  return { candidate };
}
