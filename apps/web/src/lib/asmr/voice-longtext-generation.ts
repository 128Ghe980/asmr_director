import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { availableParallelism, freemem } from "node:os";
import type { AudioCandidate, AudioCandidateProvenance } from "./audio-candidate";
import { resolveClipAssetPath, saveClipAsset } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { analyzeVoiceGroup, getVoiceAnalysisReadiness, VoiceGroupAnalysisError } from "./voice-group-analysis";
import { buildLongTextInputs, chooseGroupPauses, createSemanticVoiceLongTextPlan } from "./voice-longtext-plan";
import { planVoiceLongText } from "./voice-longtext-planner";
import { VoiceLongTextResultSchema, type VoiceLongTextResult } from "./voice-longtext-result";
import { generateVoxCpm2, VoxCpm2Error } from "./voxcpm2-provider";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
import { getVoiceGenerationRoot } from "./voice-generation-recordings";
import { VoiceGenerationContextSchema, type VoiceGenerationContext } from "./voice-generation-context";
import { VoiceRecognitionSchema, type VoiceContentComparison, type VoiceRecognition } from "./voice-recognition";

export type VoiceGenerationProgress = { progress: number; message: string };
type GroupAudio = { wav: Uint8Array; leadingQuietMs: number; trailingQuietMs: number };

export function assembleVoiceGroups(groups: GroupAudio[], joins: ReturnType<typeof chooseGroupPauses>) {
  if (!groups.length || joins.length !== groups.length - 1) throw new Error("Invalid group join count");
  const decoded = groups.map(({ wav }) => decodePcmWav(wav));
  if (decoded.some((group) => group.sampleRate !== 48_000 || group.channels !== 1 || !group.samples.length)) throw new Error("Invalid group audio");
  const gaps = joins.map((join, index) => {
    const existing = groups[index].trailingQuietMs + groups[index + 1].leadingQuietMs;
    if (!Number.isFinite(existing) || existing < 0) throw new Error("Invalid measured quiet");
    // The analysis helper has already trimmed only safe quiet edges. Never cut
    // further into the protected word edges merely to hit a requested duration.
    const addedSamples = Math.max(0, Math.round((join.durationMs - existing) * 48));
    return { addedSamples, actualDurationMs: Math.round((existing + addedSamples / 48) * 10) / 10 };
  });
  const frameCount = decoded.reduce((sum, audio) => sum + audio.samples.length, 0) + gaps.reduce((sum, gap) => sum + gap.addedSamples, 0);
  // Twelve full originals may be retained when extraction needs human review.
  if (frameCount > 48_000 * 1500) throw new Error("Long-text output too large");
  const samples = new Float32Array(frameCount);
  let offset = 0;
  decoded.forEach((audio, index) => { samples.set(audio.samples, offset); offset += audio.samples.length + (gaps[index]?.addedSamples ?? 0); });
  // Match the accepted recipe's one whole-result active-RMS adjustment. Group
  // ratios, internal pauses and speech speed remain unchanged.
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const floor = Math.max(peak * .01, .001);
  let power = 0; let count = 0;
  for (const sample of samples) if (Math.abs(sample) >= floor) { power += sample * sample; count++; }
  if (!count) return { wav: writePcm16Wav(samples, 48_000), loudnessGainDb: 0,
    joins: joins.map((join, index) => ({ ...join, actualDurationMs: gaps[index].actualDurationMs })) };
  const rms = Math.sqrt(power / count);
  const gain = Math.min(10 ** (-27 / 20) / rms, 10 ** (-1 / 20) / peak);
  for (let index = 0; index < samples.length; index++) samples[index] *= gain;
  return {
    wav: writePcm16Wav(samples, 48_000), loudnessGainDb: 20 * Math.log10(gain),
    joins: joins.map((join, index) => ({ ...join, actualDurationMs: gaps[index].actualDurationMs })),
  };
}

type LongTextInput = {
  text: string; clipId: string; voicePackId: string;
  projectId?: string; sourceFingerprint?: string;
  referenceMode: "reference_only" | "with_reference_text";
  analysisProvider: "local" | "api"; config: LocalRuntimeConfig; signal?: AbortSignal;
  onProgress?: (progress: VoiceGenerationProgress) => void;
  retryCandidate?: AudioCandidate; retryGroupIndex?: number;
  context?: VoiceGenerationContext;
};
type Dependencies = {
  plan?: typeof planVoiceLongText; generate?: typeof generateVoxCpm2; analyze?: typeof analyzeVoiceGroup;
  readiness?: typeof getVoiceAnalysisReadiness; timeoutMs?: number;
  writeTrace?: (filePath: string, data: string | Uint8Array) => Promise<void>;
  pipeline?: "overlap" | "serial";
};

const FULL_SOURCE_REVIEW_WARNING = "本候选保留了待确认组的完整原音，可能包含后续台词、补句或重复内容；各次完整原音都可单独试听、下载，请听后决定是否采用。";

function reviewMessage(index: number, text: string, code?: string, reasonOverride?: string) {
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  const excerpt = characters.slice(0, 28).join("") + (characters.length > 28 ? "…" : "");
  const reason = reasonOverride ?? (code === "uncertain_word_alignment" ? "识别文字未能定位目标句的结束位置"
    : code === "cut_text_mismatch" ? "截取后的识别文字与目标台词存在差异"
    : ["missing_speech", "incomplete_or_unrelated_speech", "missing_or_extra_speech", "repeated_speech", "unrecognized_continuation"].includes(code ?? "") ? "识别文字与目标台词存在差异"
    : ["no_safe_quiet_cut", "no_verified_quiet_cut", "missing_continuation_boundary", "uncertain_boundary_timestamps", "invalid_word_timestamps", "invalid_quiet_crop", "missing_internal_boundary", "uncertain_internal_pause"].includes(code ?? "") ? "分段位置未能确认"
    : "录音检查未完成");
  return `第 ${index + 1} 段“${excerpt}”：${reason}，已保留完整原音供试听，没有因此重新生成或丢弃录音。`;
}

function contentDifferenceMessage(index: number, comparison: VoiceContentComparison) {
  return `第 ${index + 1} 段：已截取目标片段；识别结果与源文有差异（相似度 ${(comparison.similarity * 100).toFixed(1)}%），请试听确认。`;
}

export async function generateVoiceLongText(input: LongTextInput, deps: Dependencies = {}): Promise<{
  wav: Uint8Array; provenance: AudioCandidateProvenance; qualityWarnings: string[];
}> {
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new VoxCpm2Error("长文生成超时。已完成的完整原音仍可试听、下载。", 504)), deps.timeoutMs ?? 30 * 60 * 1000);
  const signal = controller.signal;
  const check = () => { if (signal.aborted) throw signal.reason instanceof VoxCpm2Error ? signal.reason : new VoxCpm2Error("已取消生成，已完成的原音仍可试听、下载。", 499); };
  let progressValue = 0;
  const progress = (value: number, message: string) => { check(); progressValue = Math.max(progressValue, value); input.onProgress?.({ progress: progressValue, message }); };
  try {
    check();
    if (!input.text.trim() || input.text.trim().length > 500 || !/[\p{L}\p{N}]/u.test(input.text)) {
      throw new VoxCpm2Error("长文人声需要 1 至 500 字的可朗读文案，请拆分过长片段后再生成。", 400);
    }
    return await withVoxCpm2RuntimeSession(input.config, signal, async (runtimeSession) => {
      const traceRoot = path.join(getVoiceGenerationRoot(input.config), "long-text", randomUUID());
      await mkdir(traceRoot, { recursive: true });
      const writeTrace = deps.writeTrace ?? ((filePath, data) => writeFile(filePath, data));
      const record = (name: string, value: unknown) => writeTrace(path.join(traceRoot, name), JSON.stringify(value, null, 2));
      const bestEffortRecord = (name: string, value: unknown) => record(name, value).catch(() => undefined);
      let pending: Promise<void> | undefined;
      let asyncError: unknown;
      try {
        progress(3, "正在分组文案，同时准备录音检查");
        // Readiness is advisory and overlaps planning/the first TTS. A missing
        // recognizer must never prevent the model's original audio being delivered.
        const readiness = (deps.readiness ?? getVoiceAnalysisReadiness)(input.config, { runtimeSession })
          .catch(() => ({ available: false, reason: "录音检查暂不可用" }));
        const prior = input.retryCandidate?.provenance.longText;
        const context = input.context ? VoiceGenerationContextSchema.parse(input.context) : undefined;
        if (prior && JSON.stringify(prior.context) !== JSON.stringify(context)) {
          throw new VoxCpm2Error("原候选的后续文案已修改，请重新生成。", 400);
        }
        const plan = prior?.plan ?? (context
          ? createSemanticVoiceLongTextPlan(input.text, context)
          : await (deps.plan ?? planVoiceLongText)({ text: input.text, analysisProvider: input.analysisProvider, signal }));
        if (plan.clauses.join("") !== input.text.trim()) throw new VoxCpm2Error("分组内容与当前文案不一致，请重新生成。", 400);
        check();
        let targets: ReturnType<typeof buildLongTextInputs>;
        try { targets = buildLongTextInputs(plan, context); }
        catch { throw new VoxCpm2Error("文案分组或加上停顿标点后的输入超出限制，请拆分片段后再生成。", 400); }
        if (prior && (prior.groups.length !== targets.length || targets.some((target, index) => {
          const group = prior.groups[index];
          return !group || group.text !== target.expectedText || group.inputText !== target.text || group.isFinal !== target.isFinal;
        }))) throw new VoxCpm2Error("原候选的分组或生成语境已失效，请重新生成。", 400);
        await record("plan.json", { plan, targets, projectId: input.projectId, clipId: input.clipId,
          sourceFingerprint: input.sourceFingerprint, context, createdAt: new Date().toISOString() });
        const metadata: VoiceLongTextResult["groups"] = [];
        const audioGroups: GroupAudio[] = [];
        // Rebuild analysis notices from the final groups. Match only exact
        // generated messages, including older wording; preserve native/planner
        // cautions whose provenance cannot be resolved by this partial retry.
        const previousAnalysisWarnings = new Set(prior ? [FULL_SOURCE_REVIEW_WARNING] : []);
        for (const group of prior?.groups ?? []) {
          previousAnalysisWarnings.add(reviewMessage(group.index, group.text, group.diagnosticCode));
          for (const reason of ["识别文字未能定位目标句的结束位置", "截取后的识别文字与目标台词存在差异", "识别文字与目标台词存在差异",
            "分段位置未能确认", "录音检查未完成", "截取后的录音与台词未能核对一致", "录音与台词未能核对一致"]) {
            previousAnalysisWarnings.add(reviewMessage(group.index, group.text, group.diagnosticCode, reason));
          }
          const comparison = group.recognition?.contentComparison;
          if (comparison?.status === "different") previousAnalysisWarnings.add(contentDifferenceMessage(group.index, comparison));
        }
        const warnings = [...plan.warnings, ...(input.retryCandidate?.qualityWarnings ?? []).filter((warning) => !previousAnalysisWarnings.has(warning))];
        let firstProvenance: AudioCandidateProvenance | undefined = input.retryCandidate?.provenance;
        let asrModel = prior?.asrModel ?? "unavailable";
        const startedAt = Date.now();
        const mode = deps.pipeline ?? process.env.ASMR_VOICE_PIPELINE;
        const overlap = mode === "overlap" || (mode !== "serial" && freemem() >= 8 * 1024 ** 3 && availableParallelism() >= 8);
        let analysisUnavailable = false;
        const finishPending = async () => { await pending; pending = undefined; if (asyncError) throw asyncError; check(); };
        const saveFailure = (index: number) => new VoxCpm2Error(`第 ${index + 1} 段保存录音时失败。请检查运行目录的可用空间和写入权限。已保存的原音仍可试听、下载。`, 503);
        const consume = async (index: number, take: Awaited<ReturnType<typeof generateVoxCpm2>>) => {
          const target = targets[index], prefix = `group-${index + 1}-take-1`;
          const analysisStarted = Date.now();
          progress(8 + index / targets.length * 84, `正在检查第 ${index + 1}/${targets.length} 组；完整原音已可试听`);
          let analysis: Awaited<ReturnType<typeof analyzeVoiceGroup>> | undefined;
          let diagnosticCode: string | undefined;
          let recognition: VoiceRecognition | undefined;
          try {
            const ready = await readiness;
            check();
            if (!ready.available || analysisUnavailable) throw new VoiceGroupAnalysisError("录音检查暂不可用", 503, "analysis_unavailable");
            analysis = await (deps.analyze ?? analyzeVoiceGroup)({ wav: take.wav, expectedText: target.expectedText,
              followingText: target.followingText, clauses: target.clauses, config: input.config, signal }, { runtimeSession });
            recognition = analysis.recognition;
            check();
            decodePcmWav(analysis.wav);
          } catch (error) {
            analysis = undefined;
            diagnosticCode = error instanceof VoiceGroupAnalysisError ? error.diagnosticCode ?? "analysis_unavailable" : "analysis_failed";
            const diagnostic = VoiceRecognitionSchema.safeParse(error instanceof VoiceGroupAnalysisError ? error.recognition : undefined);
            recognition = diagnostic.success && diagnostic.data.expectedText === target.expectedText
              && (diagnostic.data.followingText ?? "") === (target.followingText ?? "") ? diagnostic.data : recognition ?? {
                stage: "unavailable", sourceTranscript: "", expectedText: target.expectedText,
                ...(target.followingText ? { followingText: target.followingText } : {}),
              };
            if (error instanceof VoiceGroupAnalysisError && [503, 504].includes(error.statusCode)) analysisUnavailable = true;
            await bestEffortRecord(`${prefix}-failure.json`, { stage: "analyze", code: diagnosticCode,
              message: reviewMessage(index, target.expectedText, diagnosticCode), recognition, retainedOriginal: true, at: new Date().toISOString() });
            check();
          }
          const wav = analysis?.wav ?? take.wav;
          const decoded = decodePcmWav(wav);
          const duration = decoded.samples.length / decoded.sampleRate / decoded.channels;
          try {
            const asset = await saveClipAsset({ config: input.config, clipId: `${input.clipId}_group_${index + 1}`, wav, duration });
            check();
            const { wav: _wav, ...checks } = analysis ?? { wav };
            void _wav;
            await bestEffortRecord(`${prefix}-analysis.json`, { ...checks, checkStatus: analysis ? "passed" : "review", diagnosticCode,
              recognition, analysisDurationMs: Date.now() - analysisStarted });
            firstProvenance ??= take.provenance;
            if (analysis) asrModel = analysis.asrModel;
            metadata.push({ index, text: target.expectedText, inputText: target.text, paddingClauses: target.paddingClauses,
              isFinal: target.isFinal, pauseAfter: plan.groups[index].pauseAfter,
              seed: take.provenance.seed, parameters: take.provenance.parameters, asset,
              internalPausesMs: analysis?.internalPausesMs ?? [],
              internalPauseClasses: plan.clausePauseClasses.slice(plan.groups[index].start, plan.groups[index].end),
              leadingQuietMs: analysis?.leadingQuietMs ?? 0, trailingQuietMs: analysis?.trailingQuietMs ?? 0,
              transcript: analysis?.transcript ?? "", recognition, coverage: analysis?.coverage ?? 0,
              cutStartSeconds: analysis?.cutStartSeconds ?? 0, cutEndSeconds: analysis?.cutEndSeconds ?? duration,
              attempts: 1, runtimeVersion: take.provenance.runtimeVersion, referenceIdentity: take.provenance.referenceIdentity,
              checkStatus: analysis ? "passed" : "review", diagnosticCode });
            audioGroups.push({ wav, leadingQuietMs: analysis?.leadingQuietMs ?? 0, trailingQuietMs: analysis?.trailingQuietMs ?? 0 });
            warnings.push(...take.qualityWarnings);
            await bestEffortRecord("groups.json", metadata);
            progress(8 + (index + 1) / targets.length * 84, `第 ${index + 1}/${targets.length} 组已完成${analysis ? "" : "，完整原音待试听确认"}`);
          } catch { check(); await bestEffortRecord(`${prefix}-failure.json`, { stage: "save", message: saveFailure(index).message }); throw saveFailure(index); }
        };
        for (let index = 0; index < targets.length; index++) {
          const target = targets[index];
          check();
          if (prior && index !== input.retryGroupIndex) {
            await finishPending();
            const group = prior.groups[index];
            if (!group || group.text !== target.expectedText) throw new VoxCpm2Error("原候选分组已失效，请重新生成。", 400);
            const assetPath = resolveClipAssetPath(group.asset.assetId, input.config);
            const assetInfo = await stat(assetPath);
            if (!assetInfo.isFile() || assetInfo.size > 24 * 1024 * 1024) throw new VoxCpm2Error("原候选分组音频不可用，请重新生成。", 400);
            const wav = new Uint8Array(await readFile(assetPath));
            check(); metadata.push(group); audioGroups.push({ wav, leadingQuietMs: group.leadingQuietMs, trailingQuietMs: group.trailingQuietMs });
            continue;
          }
          if (!overlap) await finishPending();
          const prefix = `group-${index + 1}-take-1`;
          let rawSaved = false;
          const publishRaw = async (wav: Uint8Array) => {
            try {
              const source = path.join(traceRoot, `${prefix}-source.wav`);
              await writeTrace(`${source}.tmp`, wav);
              await rename(`${source}.tmp`, source);
              rawSaved = true;
            }
            catch { throw saveFailure(index); }
          };
          progress(8 + index / targets.length * 84, `正在生成第 ${index + 1}/${targets.length} 组${pending ? "，同时检查上一组" : ""}`);
          const generationStarted = Date.now();
          let take: Awaited<ReturnType<typeof generateVoxCpm2>>;
          try {
            take = await (deps.generate ?? generateVoxCpm2)({ text: target.text, voicePackId: input.voicePackId,
              referenceMode: input.referenceMode, config: input.config, signal, onRawOutput: publishRaw }, { runtimeSession });
            // Publish before any recognition or content decision, including on cancellation.
            if (!rawSaved) await publishRaw(take.wav);
            await bestEffortRecord(`${prefix}-source.json`, { ...take.provenance, generationDurationMs: Date.now() - generationStarted });
          } catch (error) {
            await bestEffortRecord(`${prefix}-failure.json`, { stage: rawSaved ? "save" : "generate",
              message: error instanceof Error ? error.message : "生成未完成", at: new Date().toISOString() });
            check();
            if (error instanceof VoxCpm2Error) throw error;
            throw new VoxCpm2Error(`第 ${index + 1} 段模型生成未完成。已保存的完整原音仍可试听、下载。`);
          }
          check();
          // At most one completed take waits behind one ASR job. No unbounded
          // Promise.all across heavy models, and ASR always preserves group order.
          await finishPending();
          pending = consume(index, take).catch((error: unknown) => { asyncError = error; controller.abort(error); });
        }
        await finishPending();
        progress(94, "正在连接语音与停顿");
        const assembled = assembleVoiceGroups(audioGroups, chooseGroupPauses(metadata));
        const longText = VoiceLongTextResultSchema.parse({ version: 1, analysisProvider: plan.provider, analysisModel: plan.model, plan, ...(context ? { context } : {}),
          ...(input.retryCandidate ? { baseCandidateId: input.retryCandidate.candidateId, rerolledGroup: input.retryGroupIndex } : {}),
          groups: metadata, joins: assembled.joins, loudnessGainDb: assembled.loudnessGainDb, asrModel });
        for (const group of metadata) {
          if (group.checkStatus === "review") warnings.push(reviewMessage(group.index, group.text, group.diagnosticCode));
          const comparison = group.recognition?.contentComparison;
          if (group.checkStatus === "passed" && comparison?.status === "different") warnings.push(contentDifferenceMessage(group.index, comparison));
        }
        if (metadata.some((group) => group.checkStatus === "review")) warnings.push(FULL_SOURCE_REVIEW_WARNING);
        if (assembled.joins.some((join) => join.actualDurationMs > join.durationMs + 15)) warnings.push("部分连接保留了较长的自然停顿，请试听后决定是否采用。");
        await bestEffortRecord("result.json", longText);
        await bestEffortRecord("performance.json", { pipeline: overlap ? "overlap" : "serial", totalDurationMs: Date.now() - startedAt,
          generatedGroups: metadata.filter((group) => !prior || group.index === input.retryGroupIndex).length, automaticQualityRetries: 0 });
        await writeTrace(path.join(traceRoot, "assembled.wav"), assembled.wav).catch(() => undefined);
        progress(98, "正在保存长文候选");
        return { wav: assembled.wav, provenance: { ...firstProvenance!, seed: metadata[0].seed,
          runtimeVersion: metadata[0].runtimeVersion, referenceIdentity: metadata[0].referenceIdentity,
          generationMode: "long_text", longText,
          parameters: { ...metadata[0].parameters, groupCount: metadata.length, normalization: "whole_active_rms_-27dBFS", padding: "fixed_neutral",
            pipeline: overlap ? "overlap" : "serial", automaticQualityRetries: 0, totalTimeoutMs: deps.timeoutMs ?? 30 * 60 * 1000 } },
          qualityWarnings: [...new Set(warnings)] };
      } catch (error) {
        controller.abort(error);
        await pending;
        await bestEffortRecord("failure.json", { message: error instanceof Error ? error.message : "Failed", cancelled: input.signal?.aborted ?? false, at: new Date().toISOString() });
        throw error;
      }
    });
  } finally { clearTimeout(timeout); input.signal?.removeEventListener("abort", abort); }
}
