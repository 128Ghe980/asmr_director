import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AudioCandidate, AudioCandidateProvenance } from "./audio-candidate";
import { resolveClipAssetPath, saveClipAsset } from "./local-asset-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { analyzeVoiceGroup, getVoiceAnalysisReadiness, VoiceGroupAnalysisError } from "./voice-group-analysis";
import { buildLongTextInputs, chooseGroupPauses } from "./voice-longtext-plan";
import { planVoiceLongText } from "./voice-longtext-planner";
import { VoiceLongTextResultSchema, type VoiceLongTextResult } from "./voice-longtext-result";
import { generateVoxCpm2, VoxCpm2Error } from "./voxcpm2-provider";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

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
  if (frameCount > 48_000 * 600) throw new Error("Long-text output too large");
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
  if (!count) throw new Error("Silent long-text output");
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
  referenceMode: "reference_only" | "with_reference_text";
  analysisProvider: "local" | "api"; config: LocalRuntimeConfig; signal?: AbortSignal;
  onProgress?: (progress: VoiceGenerationProgress) => void;
  retryCandidate?: AudioCandidate; retryGroupIndex?: number;
};
type Dependencies = {
  plan?: typeof planVoiceLongText; generate?: typeof generateVoxCpm2; analyze?: typeof analyzeVoiceGroup;
  readiness?: typeof getVoiceAnalysisReadiness; timeoutMs?: number;
  writeTrace?: (filePath: string, data: string | Uint8Array) => Promise<void>;
};

type GroupFailureStage = "generate" | "analyze" | "save";

function groupFailureMessage(index: number, text: string, attempts: number, stage: GroupFailureStage, error: unknown) {
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  const excerpt = characters.slice(0, 28).join("") + (characters.length > 28 ? "…" : "");
  const prefix = `第 ${index + 1} 段“${excerpt}”已尝试 ${attempts} 次，仍未完成。`;
  if (stage === "generate") {
    const reason = error instanceof VoxCpm2Error ? error.message : "请稍后重试；若仍失败，请检查本机模型运行环境。";
    return `${prefix}模型生成失败。${reason}`;
  }
  if (stage === "save") return `${prefix}保存这段录音时失败。请检查运行目录的可用空间和写入权限，然后重试。`;
  const code = error instanceof VoiceGroupAnalysisError ? error.diagnosticCode : undefined;
  const retryAdvice = "可以重试；文案较短时，也可以在“生成方式”里选“当前片段”，生成后完整试听。";
  switch (code) {
    case "no_safe_quiet_cut":
    case "no_verified_quiet_cut":
      return `${prefix}暂时找不到能确认不截掉字音的分段位置，因此没有拼接这次结果。${retryAdvice}`;
    case "missing_continuation_boundary":
    case "uncertain_boundary_timestamps":
    case "invalid_word_timestamps":
    case "invalid_quiet_crop":
    case "missing_internal_boundary":
    case "uncertain_internal_pause":
      return `${prefix}还不能确定句子的起止位置和停顿，无法截取、拼接这段录音。${retryAdvice}`;
    case "cut_text_mismatch":
      return `${prefix}截取后的录音与台词未能核对一致，可能是识别没听清，也可能有漏字或多读。${retryAdvice}`;
    case "missing_speech":
    case "incomplete_or_unrelated_speech":
    case "missing_or_extra_speech":
    case "repeated_speech":
    case "uncertain_word_alignment":
    case "unrecognized_continuation":
      return `${prefix}录音与台词未能核对一致，可能是识别没听清，也可能有漏字或多读。${retryAdvice}`;
    case "silent_audio":
    case "invalid_audio":
    case "audio_too_large":
      return `${prefix}模型输出的录音没有通过音频检查，请重新生成。`;
    case "invalid_target":
    case "clauses_do_not_cover_target":
      return `${prefix}分段信息与台词未能对应，请重新生成。`;
    default:
      return `${prefix}录音检查未完成，暂时无法判断台词是否完整。请重试；若仍失败，请检查本机语音分析环境。`;
  }
}

export async function generateVoiceLongText(input: LongTextInput, deps: Dependencies = {}): Promise<{
  wav: Uint8Array; provenance: AudioCandidateProvenance; qualityWarnings: string[];
}> {
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new VoxCpm2Error("长文生成超时，本次没有产生完整候选。请缩短文案后重试。", 504)), deps.timeoutMs ?? 30 * 60 * 1000);
  const signal = controller.signal;
  const check = () => { if (signal.aborted) throw signal.reason instanceof VoxCpm2Error ? signal.reason : new VoxCpm2Error("已取消生成。", 499); };
  const progress = (value: number, message: string) => { check(); input.onProgress?.({ progress: value, message }); };
  try {
    check();
    if (!input.text.trim() || input.text.trim().length > 500 || !/[\p{L}\p{N}]/u.test(input.text)) {
      throw new VoxCpm2Error("长文人声需要 1 至 500 字的可朗读文案，请拆分过长片段后再生成。", 400);
    }
    const ready = await (deps.readiness ?? getVoiceAnalysisReadiness)(input.config);
    check();
    if (!ready.available) throw new VoxCpm2Error(ready.reason ?? "长文语音分析尚未就绪。", 503);
    return await withVoxCpm2RuntimeSession(input.config, signal, async (runtimeSession) => {
      const traceRoot = path.join(input.config.runtimeRoot, "voxcpm2-product", "long-text", randomUUID());
      await mkdir(traceRoot, { recursive: true });
      const writeTrace = deps.writeTrace ?? ((filePath, data) => writeFile(filePath, data));
      const record = (name: string, value: unknown) => writeTrace(path.join(traceRoot, name), JSON.stringify(value, null, 2));
      try {
        progress(3, "正在分组文案");
        const prior = input.retryCandidate?.provenance.longText;
        const plan = prior?.plan ?? await (deps.plan ?? planVoiceLongText)({ text: input.text, analysisProvider: input.analysisProvider, signal });
        if (plan.clauses.join("") !== input.text.trim()) throw new VoxCpm2Error("分组内容与当前文案不一致，请重新生成。", 400);
        check();
        let targets: ReturnType<typeof buildLongTextInputs>;
        try { targets = buildLongTextInputs(plan); }
        catch { throw new VoxCpm2Error("文案分组或加上停顿标点后的输入超出限制，请拆分片段后再生成。", 400); }
        await record("plan.json", { plan, targets, createdAt: new Date().toISOString() });
        const metadata: VoiceLongTextResult["groups"] = [];
        const audioGroups: GroupAudio[] = [];
        // A partial retry does not certify that earlier audio cautions are resolved.
        // Preserve prior candidate warnings conservatively alongside new checks.
        const warnings = [...plan.warnings, ...(input.retryCandidate?.qualityWarnings ?? [])];
        let firstProvenance: AudioCandidateProvenance | undefined = input.retryCandidate?.provenance;
        let asrModel = "";
        for (let index = 0; index < targets.length; index++) {
          const target = targets[index];
          check();
          if (prior && index !== input.retryGroupIndex) {
            const group = prior.groups[index];
            if (!group || group.text !== target.expectedText) throw new VoxCpm2Error("原候选分组已失效，请重新生成。", 400);
            const assetPath = resolveClipAssetPath(group.asset.assetId, input.config);
            const assetInfo = await stat(assetPath);
            if (!assetInfo.isFile() || assetInfo.size > 24 * 1024 * 1024) throw new VoxCpm2Error("原候选分组音频不可用，请重新生成。", 400);
            const wav = new Uint8Array(await readFile(assetPath));
            check();
            metadata.push(group);
            audioGroups.push({ wav, leadingQuietMs: group.leadingQuietMs, trailingQuietMs: group.trailingQuietMs });
            asrModel = prior.asrModel;
            continue;
          }
          let accepted = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            check();
            const baseProgress = 8 + index / targets.length * 84;
            progress(baseProgress, `正在生成第 ${index + 1}/${targets.length} 组${attempt > 1 ? `（重试 ${attempt - 1}）` : ""}`);
            const tracePrefix = `group-${index + 1}-take-${attempt}`;
            let failureStage: GroupFailureStage = "generate";
            try {
              const take = await (deps.generate ?? generateVoxCpm2)({ text: target.text, voicePackId: input.voicePackId, referenceMode: input.referenceMode, config: input.config, signal }, { runtimeSession });
              check();
              failureStage = "save";
              await writeTrace(path.join(traceRoot, `${tracePrefix}-source.wav`), take.wav);
              await record(`${tracePrefix}-source.json`, take.provenance);
              progress(baseProgress + 35 / targets.length, `正在核对第 ${index + 1}/${targets.length} 组台词`);
              failureStage = "analyze";
              const analysis = await (deps.analyze ?? analyzeVoiceGroup)({ wav: take.wav, expectedText: target.expectedText, followingText: target.followingText, clauses: target.clauses, config: input.config, signal }, { runtimeSession });
              check();
              const { wav, ...checks } = analysis;
              const decoded = decodePcmWav(wav);
              failureStage = "save";
              await record(`${tracePrefix}-analysis.json`, checks);
              const asset = await saveClipAsset({ config: input.config, clipId: `${input.clipId}_group_${index + 1}`, wav, duration: decoded.samples.length / decoded.sampleRate / decoded.channels });
              check();
              firstProvenance ??= take.provenance;
              asrModel = analysis.asrModel;
              metadata.push({
                index, text: target.expectedText, inputText: target.text, paddingClauses: target.paddingClauses,
                isFinal: target.isFinal, pauseAfter: plan.groups[index].pauseAfter,
                seed: take.provenance.seed, parameters: take.provenance.parameters, asset,
                internalPausesMs: analysis.internalPausesMs,
                internalPauseClasses: plan.clausePauseClasses.slice(plan.groups[index].start, plan.groups[index].end),
                leadingQuietMs: analysis.leadingQuietMs, trailingQuietMs: analysis.trailingQuietMs,
                transcript: analysis.transcript, coverage: analysis.coverage,
                cutStartSeconds: analysis.cutStartSeconds, cutEndSeconds: analysis.cutEndSeconds,
                attempts: attempt, runtimeVersion: take.provenance.runtimeVersion, referenceIdentity: take.provenance.referenceIdentity,
              });
              audioGroups.push({ wav, leadingQuietMs: analysis.leadingQuietMs, trailingQuietMs: analysis.trailingQuietMs });
              warnings.push(...take.qualityWarnings);
              await record("groups.json", metadata);
              accepted = true;
              break;
            } catch (error) {
              check();
              // A full/unwritable disk may also reject this diagnostic. Preserve
              // the original failure instead of replacing it with a log error.
              await record(`${tracePrefix}-failure.json`, { message: error instanceof Error ? error.message : "Group failed",
                stage: failureStage, code: error instanceof VoiceGroupAnalysisError ? error.diagnosticCode : undefined, at: new Date().toISOString() }).catch(() => undefined);
              // Configuration/resource/cancellation faults will not improve with
              // another seed. Only failed generation/alignment takes are retried.
              if (failureStage === "save") throw new VoxCpm2Error(groupFailureMessage(index, target.expectedText, attempt, failureStage, error), 503);
              if (error instanceof VoxCpm2Error && error.statusCode !== 502) throw error;
              if (error instanceof VoiceGroupAnalysisError && ![422, 502].includes(error.statusCode)) throw new VoxCpm2Error(error.message, error.statusCode);
              if (attempt === 3) throw new VoxCpm2Error(groupFailureMessage(index, target.expectedText, attempt, failureStage, error));
            }
          }
          if (!accepted) throw new VoxCpm2Error("长文片段未完成，请重试。");
        }
        check();
        progress(94, "正在连接语音与停顿");
        const assembled = assembleVoiceGroups(audioGroups, chooseGroupPauses(metadata));
        const longText = VoiceLongTextResultSchema.parse({ version: 1, analysisProvider: plan.provider, analysisModel: plan.model, plan,
          ...(input.retryCandidate ? { baseCandidateId: input.retryCandidate.candidateId, rerolledGroup: input.retryGroupIndex } : {}),
          groups: metadata, joins: assembled.joins, loudnessGainDb: assembled.loudnessGainDb, asrModel });
        if (assembled.joins.some((join) => join.actualDurationMs > join.durationMs + 15)) warnings.push("部分连接保留了较长的自然停顿，请试听后决定是否采用。");
        await record("result.json", longText);
        await writeTrace(path.join(traceRoot, "assembled.wav"), assembled.wav);
        check();
        progress(98, "正在保存长文候选");
        return { wav: assembled.wav, provenance: { ...firstProvenance!, seed: metadata[0].seed,
          runtimeVersion: metadata[0].runtimeVersion, referenceIdentity: metadata[0].referenceIdentity,
          generationMode: "long_text", longText,
          parameters: { ...metadata[0].parameters, groupCount: metadata.length, normalization: "whole_active_rms_-27dBFS", padding: "fixed_neutral", totalTimeoutMs: deps.timeoutMs ?? 30 * 60 * 1000 } },
          qualityWarnings: [...new Set(warnings)] };
      } catch (error) {
        await record("failure.json", { message: error instanceof Error ? error.message : "Failed", cancelled: signal.aborted, at: new Date().toISOString() }).catch(() => undefined);
        throw error;
      }
    });
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
}
