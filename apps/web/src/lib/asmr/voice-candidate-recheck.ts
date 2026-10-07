import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { saveClipAsset } from "./local-asset-store";
import { CandidateSourceChangedError, ensureAudioCandidateCapacity, getAudioCandidate, saveAudioCandidate } from "./local-candidate-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./pcm-audio";
import type { AsmrProject } from "./schema";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getVoiceGenerationRoot, MAX_RECORDING_BYTES } from "./voice-generation-recordings";
import { analyzeVoiceGroup, VoiceGroupAnalysisError, type VoiceGroupAnalysis } from "./voice-group-analysis";
import { assembleVoiceGroups } from "./voice-longtext-generation";
import { buildLongTextInputs, chooseGroupPauses } from "./voice-longtext-plan";
import { VoiceLongTextResultSchema, type VoiceLongTextResult } from "./voice-longtext-result";
import { VoiceRecognitionSchema, type VoiceRecognition } from "./voice-recognition";
import { getVoiceReviewWarning } from "./voice-review-warning";
import { flattenClips } from "./view-model";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
import { getLocalStorageError } from "./local-storage-error";

const RUN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_JSON_BYTES = 1024 * 1024;
const FULL_SOURCE_WARNING = "本候选保留了待确认组的完整原音，可能包含后续台词、补句或重复内容；各次完整原音都可单独试听、下载，请听后决定是否采用。";
const JOIN_WARNING = "部分连接保留了较长的自然停顿，请试听后决定是否采用。";
const SourceSchema = z.object({ provider: z.literal("voxcpm2"), model: z.string(), seed: z.number().int(),
  voicePackId: z.string(), referenceMode: z.string(), generationMode: z.literal("clip"),
  parameters: z.record(z.string(), z.unknown()), runtimeVersion: z.string().optional(), referenceIdentity: z.string().optional() });
type SavedSource = { wavPath: string; metadataPath: string };
type RecheckInput = { project: AsmrProject; clipId: string; candidateId: string; config: LocalRuntimeConfig; signal?: AbortSignal };
type Dependencies = { analyze?: typeof analyzeVoiceGroup; timeoutMs?: number; now?: Date };

export class VoiceCandidateRecheckError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly recognition?: VoiceRecognition) {
    super(message);
    this.name = "VoiceCandidateRecheckError";
  }
}
const sourceUnavailable = () => new VoiceCandidateRecheckError("找不到与此候选唯一对应的完整原音，暂不能重新识别；原候选仍保留。", 422);

async function safeFile(filePath: string, root: string, maximum: number) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximum) throw sourceUnavailable();
  const relative = path.relative(await realpath(root), await realpath(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw sourceUnavailable();
}
async function readJson(filePath: string, root: string): Promise<unknown> {
  await safeFile(filePath, root, MAX_JSON_BYTES);
  return JSON.parse(await readFile(filePath, "utf8"));
}

// Asset IDs identify the exact saved group. Text similarity, trace recency and
// the cropped candidate WAV cannot prove which full original produced it.
async function findOriginals(input: RecheckInput, candidate: AudioCandidate, check: () => void): Promise<SavedSource[]> {
  const prior = candidate.provenance.longText!;
  const targets = buildLongTextInputs(prior.plan!, prior.context);
  const locations = [...new Set([path.join(getVoiceGenerationRoot(input.config), "long-text"),
    path.resolve(input.config.runtimeRoot, "voxcpm2-product", "long-text")])];
  const matches: SavedSource[][] = prior.groups.map(() => []);
  let inspected = 0;
  for (const root of locations) {
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw sourceUnavailable(); }
    for (const entry of entries) {
      check();
      if (!entry.isDirectory() || !RUN_PATTERN.test(entry.name)) continue;
      if (++inspected > 1000) throw sourceUnavailable();
      try {
        const directory = path.join(root, entry.name);
        const directoryInfo = await lstat(directory);
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()
          || path.relative(await realpath(root), await realpath(directory)) !== entry.name) continue;
        const plan = await readJson(path.join(directory, "plan.json"), root) as Record<string, unknown>;
        if (plan.projectId !== candidate.projectId || plan.clipId !== candidate.clipId
          || plan.sourceFingerprint !== candidate.sourceFingerprint || !isDeepStrictEqual(plan.plan, prior.plan)
          || !isDeepStrictEqual(plan.context, prior.context) || !isDeepStrictEqual(plan.targets, targets)) continue;
        const result = VoiceLongTextResultSchema.parse(await readJson(path.join(directory, "result.json"), root));
        const recordedGroups = await readJson(path.join(directory, "groups.json"), root);
        if (!isDeepStrictEqual(result.groups, recordedGroups) || !isDeepStrictEqual(result.plan, prior.plan)
          || !isDeepStrictEqual(result.context, prior.context)) continue;
        const files = await readdir(directory);
        for (const group of prior.groups) {
          if (!isDeepStrictEqual(result.groups[group.index], group)) continue;
          const sourcePattern = new RegExp(`^group-${group.index + 1}-take-([1-9][0-9]?)\\-source\\.wav$`);
          for (const name of files) {
            const match = sourcePattern.exec(name);
            if (!match || Number(match[1]) > 20) continue;
            const wavPath = path.join(directory, name), metadataPath = wavPath.replace(/\.wav$/, ".json");
            await safeFile(wavPath, root, MAX_RECORDING_BYTES);
            const source = SourceSchema.parse(await readJson(metadataPath, root));
            if (source.model !== candidate.provenance.model || source.voicePackId !== candidate.provenance.voicePackId
              || source.referenceMode !== candidate.provenance.referenceMode || source.seed !== group.seed
              || !isDeepStrictEqual(source.parameters, group.parameters) || source.runtimeVersion !== group.runtimeVersion
              || source.referenceIdentity !== group.referenceIdentity) continue;
            if (!matches[group.index].some((existing) => existing.wavPath === wavPath)) matches[group.index].push({ wavPath, metadataPath });
          }
        }
      } catch { /* Unrelated, unfinished or corrupt traces do not prove source ownership. */ }
    }
  }
  check();
  if (matches.some((sources) => sources.length !== 1)) throw sourceUnavailable();
  return matches.map((sources) => sources[0]);
}

function differenceWarning(group: VoiceLongTextResult["groups"][number]) {
  return `第 ${group.index + 1} 段：已截取目标片段；识别结果与源文有差异（相似度 ${((group.recognition?.contentComparison?.similarity ?? 0) * 100).toFixed(1)}%），请试听确认。`;
}
function retainedWarnings(candidate: AudioCandidate) {
  const prior = candidate.provenance.longText!;
  const analysisWarnings = new Set([FULL_SOURCE_WARNING, JOIN_WARNING]);
  for (const group of prior.groups) {
    analysisWarnings.add(getVoiceReviewWarning(group.index, group.text, group.diagnosticCode));
    for (const reason of ["识别文字未能定位目标句的结束位置", "截取后的识别文字与目标台词存在差异", "识别文字与目标台词存在差异",
      "分段位置未能确认", "录音检查未完成", "截取后的录音与台词未能核对一致", "录音与台词未能核对一致"]) {
      analysisWarnings.add(getVoiceReviewWarning(group.index, group.text, group.diagnosticCode, reason));
    }
    if (group.recognition?.contentComparison?.status === "different") analysisWarnings.add(differenceWarning(group));
  }
  return [...(prior.plan?.warnings ?? []), ...candidate.qualityWarnings.filter((warning) => !analysisWarnings.has(warning))];
}

export async function recheckVoiceCandidate(input: RecheckInput, dependencies: Dependencies = {}): Promise<{ candidate: AudioCandidate }> {
  const controller = new AbortController();
  const deadline = Date.now() + (dependencies.timeoutMs ?? 300_000);
  const cancelled = new VoiceCandidateRecheckError("重新识别已取消，原候选仍保留。", 499);
  const abort = () => controller.abort(cancelled);
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new VoiceCandidateRecheckError("重新识别超时，原候选仍保留，请稍后重试。", 504)),
    dependencies.timeoutMs ?? 300_000);
  const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  try {
    check();
    const candidate = await getAudioCandidate({ config: input.config, candidateId: input.candidateId });
    const clip = flattenClips(input.project).find((item) => item.id === input.clipId);
    if (!candidate || candidate.status !== "ready" || candidate.projectId !== input.project.project_id
      || candidate.clipId !== input.clipId || clip?.type !== "voice") {
      throw new VoiceCandidateRecheckError("此候选已不可用或不属于当前片段，请刷新列表。", 404);
    }
    const prior = candidate.provenance.longText;
    if (candidate.provenance.generationMode !== "long_text" || !prior?.plan) {
      throw new VoiceCandidateRecheckError("此候选未保存可核对的分组原音，暂不能重新识别。", 400);
    }
    const context = getVoiceGenerationContext(input.project, clip.id);
    if (candidate.sourceFingerprint !== getVoiceCandidateSourceFingerprint(clip, context)
      || !isDeepStrictEqual(prior.context, context) || prior.plan.clauses.join("") !== clip.text.trim()) {
      throw new VoiceCandidateRecheckError("当前台词或后续语境已改变，请重新生成；原候选仍保留。", 409);
    }
    const targets = buildLongTextInputs(prior.plan, context);
    if (targets.length !== prior.groups.length || targets.some((target, index) => {
      const group = prior.groups[index];
      return target.expectedText !== group.text || target.text !== group.inputText
        || target.isFinal !== group.isFinal || !isDeepStrictEqual(target.paddingClauses, group.paddingClauses);
    })) throw new VoiceCandidateRecheckError("此候选的分组语境已失效，请重新生成。", 409);
    const ownership = { config: input.config, projectId: candidate.projectId, clipId: candidate.clipId,
      adoptedAssetId: clip.asset.asset_id ?? undefined };
    await ensureAudioCandidateCapacity(ownership);
    check();
    return await withVoxCpm2RuntimeSession(input.config, controller.signal, async (runtimeSession) => {
      const originals = await findOriginals(input, candidate, check);
      const measured: Array<{ wav: Uint8Array; analysis?: VoiceGroupAnalysis; recognition?: VoiceRecognition; code?: string }> = [];
      for (const [index, source] of originals.entries()) {
        check();
        await safeFile(source.wavPath, path.dirname(source.wavPath), MAX_RECORDING_BYTES);
        const wav = new Uint8Array(await readFile(source.wavPath));
        const decoded = decodePcmWav(wav);
        if (decoded.sampleRate !== 48_000 || decoded.channels !== 1 || !decoded.samples.length || decoded.samples.length > 48_000 * 120) throw sourceUnavailable();
        const target = targets[index];
        try {
          const analysis = await (dependencies.analyze ?? analyzeVoiceGroup)({ wav, expectedText: target.expectedText,
            followingText: target.followingText, clauses: target.clauses, config: input.config, signal: controller.signal },
          { runtimeSession, env: {}, timeoutMs: Math.max(1, deadline - Date.now()) });
          check();
          measured.push({ wav: analysis.wav, analysis, recognition: analysis.recognition });
        } catch (error) {
          check();
          if (!(error instanceof VoiceGroupAnalysisError) || error.statusCode !== 422) throw error;
          const evidence = VoiceRecognitionSchema.safeParse(error.recognition);
          const recognition = evidence.success && evidence.data.expectedText === target.expectedText
            && (evidence.data.followingText ?? "") === (target.followingText ?? "") ? evidence.data : {
              stage: "unavailable" as const, sourceTranscript: "", expectedText: target.expectedText,
              ...(target.followingText ? { followingText: target.followingText } : {}) };
          measured.push({ wav, recognition, code: error.diagnosticCode ?? "analysis_failed" });
        }
      }
      check();
      const current = await getAudioCandidate({ config: input.config, candidateId: candidate.candidateId });
      if (!isDeepStrictEqual(current, candidate)) throw new VoiceCandidateRecheckError("原候选状态已改变，请刷新列表。", 409);
      await ensureAudioCandidateCapacity(ownership);
      const now = dependencies.now ?? new Date();
      const traceRoot = path.join(getVoiceGenerationRoot(input.config), "long-text", randomUUID());
      await mkdir(traceRoot, { recursive: true });
      const record = (name: string, value: unknown) => writeFile(path.join(traceRoot, name), JSON.stringify(value, null, 2), { flag: "wx" });
      await record("plan.json", { plan: prior.plan, targets, projectId: candidate.projectId, clipId: candidate.clipId,
        sourceFingerprint: candidate.sourceFingerprint, ...(context ? { context } : {}), createdAt: now.toISOString(),
        recheckedFromCandidateId: candidate.candidateId });
      const groups: VoiceLongTextResult["groups"] = [];
      for (const [index, measuredGroup] of measured.entries()) {
        check();
        const original = originals[index], prefix = `group-${index + 1}-take-1`;
        await writeFile(path.join(traceRoot, `${prefix}-source.wav`), await readFile(original.wavPath), { flag: "wx" });
        await writeFile(path.join(traceRoot, `${prefix}-source.json`), await readFile(original.metadataPath), { flag: "wx" });
        const decoded = decodePcmWav(measuredGroup.wav), duration = decoded.samples.length / decoded.sampleRate / decoded.channels;
        const asset = await saveClipAsset({ config: input.config, clipId: `${clip.id}_group_${index + 1}`, wav: measuredGroup.wav, duration, now });
        const { recognition: _oldRecognition, diagnosticCode: _oldCode, ...oldGroup } = prior.groups[index];
        void _oldRecognition; void _oldCode;
        const analysis = measuredGroup.analysis;
        const group = { ...oldGroup, asset, internalPausesMs: analysis?.internalPausesMs ?? [],
          leadingQuietMs: analysis?.leadingQuietMs ?? 0, trailingQuietMs: analysis?.trailingQuietMs ?? 0,
          transcript: analysis?.transcript ?? "", recognition: measuredGroup.recognition, coverage: analysis?.coverage ?? 0,
          cutStartSeconds: analysis?.cutStartSeconds ?? 0, cutEndSeconds: analysis?.cutEndSeconds ?? duration,
          checkStatus: analysis ? "passed" as const : "review" as const,
          ...(measuredGroup.code ? { diagnosticCode: measuredGroup.code } : {}) };
        groups.push(group);
        const { wav: _wav, ...checks } = analysis ?? { wav: measuredGroup.wav };
        void _wav;
        await record(`${prefix}-analysis.json`, { ...checks, checkStatus: group.checkStatus,
          ...(group.diagnosticCode ? { diagnosticCode: group.diagnosticCode } : {}), recognition: group.recognition });
      }
      check();
      const assembled = assembleVoiceGroups(measured.map((group) => ({ wav: group.wav,
        leadingQuietMs: group.analysis?.leadingQuietMs ?? 0, trailingQuietMs: group.analysis?.trailingQuietMs ?? 0 })), chooseGroupPauses(groups));
      const longText = VoiceLongTextResultSchema.parse({ ...prior, groups, joins: assembled.joins,
        loudnessGainDb: assembled.loudnessGainDb, asrModel: measured.find((group) => group.analysis)?.analysis?.asrModel ?? "unavailable" });
      const warnings = retainedWarnings(candidate);
      for (const group of groups) {
        if (group.checkStatus === "review") warnings.push(getVoiceReviewWarning(group.index, group.text, group.diagnosticCode));
        if (group.checkStatus === "passed" && group.recognition?.contentComparison?.status === "different") warnings.push(differenceWarning(group));
      }
      if (groups.some((group) => group.checkStatus === "review")) warnings.push(FULL_SOURCE_WARNING);
      if (assembled.joins.some((join) => join.actualDurationMs > join.durationMs + 15)) warnings.push(JOIN_WARNING);
      await record("groups.json", longText.groups);
      await record("result.json", longText);
      await writeFile(path.join(traceRoot, "assembled.wav"), assembled.wav, { flag: "wx" });
      check();
      const decoded = decodePcmWav(assembled.wav);
      const asset = await saveClipAsset({ config: input.config, clipId: clip.id, wav: assembled.wav,
        duration: decoded.samples.length / decoded.sampleRate / decoded.channels, now });
      const rechecked = AudioCandidateSchema.parse({ ...candidate, candidateId: `vox_${randomUUID().replaceAll("-", "")}`, asset,
        provenance: { ...candidate.provenance, parameters: { ...candidate.provenance.parameters,
          recheckedFromCandidateId: candidate.candidateId, recheckedAt: now.toISOString() }, longText },
        qualityWarnings: [...new Set(warnings)], createdAt: now.toISOString(), status: "ready" });
      check();
      await saveAudioCandidate({ config: input.config, candidate: rechecked, adoptedAssetId: ownership.adoptedAssetId,
        signal: controller.signal, sourceCandidate: candidate });
      return { candidate: rechecked };
    });
  } catch (error) {
    check();
    if (error instanceof VoiceCandidateRecheckError) throw error;
    if (error instanceof CandidateSourceChangedError) throw new VoiceCandidateRecheckError(error.message, error.statusCode);
    if (error instanceof VoiceGroupAnalysisError) throw new VoiceCandidateRecheckError(error.message, error.statusCode, error.recognition);
    const storage = getLocalStorageError(error);
    if (storage) throw storage;
    if (error instanceof Error && "statusCode" in error) throw error;
    throw new VoiceCandidateRecheckError("重新识别未完成，原候选仍保留，请稍后重试。", 500);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
}
