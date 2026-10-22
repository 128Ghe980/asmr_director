import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AudioCandidateSchema, getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { saveClipAsset } from "./local-asset-store";
import { ensureAudioCandidateCapacity, saveParagraphAudioCandidates } from "./local-candidate-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./pcm-audio";
import type { AsmrProject } from "./schema";
import type { VoiceGenerationOptions } from "./voice-generation-options";
import { getVoiceGenerationRoot } from "./voice-generation-recordings";
import { analyzeVoiceGroup, VoiceGroupAnalysisError } from "./voice-group-analysis";
import type { VoiceGenerationProgress } from "./voice-longtext-generation";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { VoiceParagraphResultSchema, type VoiceParagraphResult } from "./voice-paragraph-result";
import { splitVoiceParagraph, type ParagraphAudioSegment } from "./voice-paragraph-split";
import { getParagraphGroup } from "./speech-workspace";
import type { VoiceRecognition } from "./voice-recognition";
import { generateVoxCpm2, VoxCpm2Error } from "./voxcpm2-provider";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

const reviewWarning = "整段已生成，但短句切分未全部通过检查；完整原音可试听、下载，确认安全分段后才能采用到短句。";
type ParagraphGenerationInput = {
  project: AsmrProject; clipId: string; config: LocalRuntimeConfig; voiceOptions: VoiceGenerationOptions;
  signal?: AbortSignal; now?: Date; onProgress?: (progress: VoiceGenerationProgress) => void;
};

export async function generateVoiceParagraphCandidates(input: ParagraphGenerationInput,
  dependencies: { generate?: typeof generateVoxCpm2; analyze?: typeof analyzeVoiceGroup; timeoutMs?: number } = {}): Promise<{ candidate: AudioCandidate }> {
  input.signal?.throwIfAborted();
  if (input.project.speechWorkspace && input.project.speechWorkspace.activeMode !== "paragraph") {
    throw new VoxCpm2Error("请切换到整段工作区后生成整段语音。", 400);
  }
  const group = getParagraphGroup(input.project, input.clipId);
  const paragraphContext = getVoiceParagraphContext(input.project, input.clipId);
  if (!group.length || group.some((clip) => clip.kind === "silent")) throw new VoxCpm2Error("无对白镜头不生成语音。", 400);
  if (!paragraphContext) throw new VoxCpm2Error("段落成员与当前台词不一致，请检查段落内容。", 400);
  if (input.voiceOptions.provider !== "voxcpm2" || input.voiceOptions.generationMode !== "paragraph") throw new VoxCpm2Error("整段生成需要选择 VoxCPM2。", 400);
  if (!paragraphContext.text.trim() || paragraphContext.text.length > 500 || group.length > 32) throw new VoxCpm2Error("一段最多包含 500 字和 32 个短句，请先拆分段落。", 400);
  const now = input.now ?? new Date();
  for (const clip of group) {
    input.signal?.throwIfAborted();
    await ensureAudioCandidateCapacity({ config: input.config, projectId: input.project.project_id, clipId: clip.id,
      adoptedAssetId: clip.asset.asset_id ?? undefined, workspaceMode: "paragraph" });
  }
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new VoxCpm2Error("整段生成与切分超时；已经保存的原音仍可试听。", 504)), dependencies.timeoutMs ?? 30 * 60 * 1000);
  const signal = controller.signal;
  const progress = (percent: number, message: string) => input.onProgress?.({ progress: percent, message });
  const traceRoot = path.join(getVoiceGenerationRoot(input.config), "long-text", randomUUID());
  const record = (name: string, value: unknown) => writeFile(path.join(traceRoot, name), JSON.stringify(value, null, 2), "utf8");
  const bestEffortRecord = (name: string, value: unknown) => record(name, value).catch(() => undefined);
  let rawSaved = false;
  const publishRaw = async (wav: Uint8Array) => {
    const target = path.join(traceRoot, "group-1-take-1-source.wav");
    await writeFile(`${target}.tmp`, wav); await rename(`${target}.tmp`, target); rawSaved = true;
  };
  try {
    await mkdir(traceRoot, { recursive: true });
    await record("plan.json", { projectId: input.project.project_id, clipId: input.clipId, createdAt: now.toISOString(), generationMode: "paragraph",
      sourceFingerprint: getVoiceCandidateSourceFingerprint(group.find((clip) => clip.id === input.clipId)!, undefined, paragraphContext),
      paragraph: paragraphContext, plan: { clauses: group.map((clip) => clip.text) },
      targets: [{ expectedText: paragraphContext.text, text: paragraphContext.text }] });
    return await withVoxCpm2RuntimeSession(input.config, signal, async (runtimeSession) => {
      progress(5, `正在一次生成整段（${group.length} 个短句）`);
      const take = await (dependencies.generate ?? generateVoxCpm2)({ text: paragraphContext.text, voicePackId: input.voiceOptions.voicePackId,
        referenceMode: input.voiceOptions.referenceMode, config: input.config, signal, now, onRawOutput: publishRaw }, { runtimeSession, paragraphMode: true, maxSteps: 800 });
      if (!rawSaved) await publishRaw(take.wav);
      await bestEffortRecord("group-1-take-1-source.json", take.provenance);
      signal.throwIfAborted();
      const decoded = decodePcmWav(take.wav);
      const duration = decoded.samples.length / decoded.channels / decoded.sampleRate;
      const sourceAsset = await saveClipAsset({ config: input.config, clipId: `${input.clipId}_paragraph_source`, wav: take.wav, duration, now });
      signal.throwIfAborted();
      let cuts: ParagraphAudioSegment[] = [];
      let diagnosticCode: string | undefined;
      let attemptedSentence: number | undefined;
      let failedClipId: string | undefined;
      let failureRecognition: VoiceRecognition | undefined;
      try {
        cuts = await splitVoiceParagraph({ wav: take.wav, targets: group.map((clip) => ({ clipId: clip.id, text: clip.text })), config: input.config, signal,
          onProgress: (index, total) => { attemptedSentence = index; progress(15 + index / total * 70, `完整原音已保存，正在定位第 ${index + 1}/${total} 个短句的切分边界`); } },
        { analyze: dependencies.analyze, runtimeSession });
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof VoiceGroupAnalysisError)) throw error;
        diagnosticCode = error.diagnosticCode ?? "paragraph_analysis_unavailable";
        failedClipId = attemptedSentence === undefined ? undefined : group[attemptedSentence]?.id;
        const failedText = attemptedSentence === undefined ? undefined : group[attemptedSentence]?.text;
        const failedFollowing = attemptedSentence === undefined ? "" : group.slice(attemptedSentence + 1).map((clip) => clip.text).join("");
        if (error.recognition && error.recognition.expectedText === failedText && (error.recognition.followingText ?? "") === failedFollowing) failureRecognition = error.recognition;
        await bestEffortRecord("group-1-take-1-failure.json", { stage: "analyze", code: diagnosticCode, message: error.message,
          recognition: failureRecognition, failedClipId, retainedOriginal: true });
      }
      const segments: VoiceParagraphResult["segments"] = [];
      // Publish slices only when every boundary is safe. Content is judged by listening.
      for (const cut of cuts) {
        signal.throwIfAborted();
        const asset = await saveClipAsset({ config: input.config, clipId: cut.clipId, wav: cut.wav, duration: cut.cutEndSeconds - cut.cutStartSeconds, now });
        segments.push({ clipId: cut.clipId, text: cut.text, asset, cutStartSeconds: cut.cutStartSeconds, cutEndSeconds: cut.cutEndSeconds,
          ...(cut.recognition ? { recognition: cut.recognition } : {}), ...(cut.textReview ? { textReview: cut.textReview } : {}) });
      }
      const paragraph = VoiceParagraphResultSchema.parse({ version: 1, groupId: paragraphContext.groupId, text: paragraphContext.text,
        clipIds: group.map((clip) => clip.id), sourceAsset, checkStatus: cuts.length ? "passed" : "review", segments,
        ...(diagnosticCode ? { diagnosticCode } : {}), ...(failedClipId ? { failedClipId } : {}), ...(failureRecognition ? { failureRecognition } : {}) });
      const qualityWarnings = [...take.qualityWarnings, ...(paragraph.checkStatus === "review" ? [reviewWarning] : []),
        ...segments.filter((segment) => segment.recognition?.contentComparison?.status === "different")
          .map((segment) => `「${segment.text}」识别文字有差异，请试听确认。`)];
      const provenance = { ...take.provenance, generationMode: "paragraph" as const, paragraph,
        parameters: { ...take.provenance.parameters, groupCount: group.length, generationCalls: 1, normalization: "none", padding: "none", automaticQualityRetries: 0 } };
      const candidates: AudioCandidate[] = [];
      for (const clip of paragraph.checkStatus !== "review" ? group : group.filter((clip) => clip.id === input.clipId)) {
        signal.throwIfAborted();
        const asset = segments.find((segment) => segment.clipId === clip.id)?.asset ?? sourceAsset;
        const candidate = AudioCandidateSchema.parse({ version: 1, candidateId: `vox_${randomUUID().replaceAll("-", "")}`,
          projectId: input.project.project_id, clipId: clip.id, sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, undefined, paragraphContext),
          requestFingerprint: getVoiceCandidateRequestFingerprint(clip, input.voiceOptions, undefined, undefined, paragraphContext), asset,
          wav: { sampleRate: decoded.sampleRate, channels: decoded.channels, bitsPerSample: 16 }, provenance,
          qualityWarnings: [...new Set(qualityWarnings)], createdAt: now.toISOString(), status: "ready" });
        candidates.push(candidate);
      }
      await saveParagraphAudioCandidates({ config: input.config, candidates,
        adoptedAssetIds: Object.fromEntries(group.map((clip) => [clip.id, clip.asset.asset_id ?? undefined])), signal });
      await bestEffortRecord("group-1-take-1-analysis.json", { checkStatus: paragraph.checkStatus, diagnosticCode, failedClipId, failureRecognition, segments });
      await bestEffortRecord("result.json", paragraph);
      progress(98, paragraph.checkStatus === "passed" ? `整段已安全切成 ${group.length} 个短句` : paragraph.checkStatus === "needs_confirmation" ? "短句已安全切分，识别差异待试听确认" : "完整原音已保留，短句切分待确认");
      return { candidate: candidates.find((candidate) => candidate.clipId === input.clipId)! };
    });
  } catch (error) {
    await bestEffortRecord("failure.json", { message: error instanceof Error ? error.message : "整段生成未完成", cancelled: signal.aborted, retainedOriginal: rawSaved });
    throw error;
  } finally { clearTimeout(timeout); input.signal?.removeEventListener("abort", abort); }
}
