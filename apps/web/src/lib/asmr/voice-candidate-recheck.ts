import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { resolveClipAssetPath, saveClipAsset } from "./local-asset-store";
import { CandidateSourceChangedError, ensureAudioCandidateCapacity, getAudioCandidate, saveAudioCandidate, saveParagraphAudioCandidates } from "./local-candidate-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav } from "./pcm-audio";
import type { AsmrProject } from "./schema";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getVoiceGenerationRoot, MAX_RECORDING_BYTES } from "./voice-generation-recordings";
import { analyzeVoiceGroup, VoiceGroupAnalysisError, type VoiceGroupAnalysis } from "./voice-group-analysis";
import { assembleVoiceGroups } from "./voice-longtext-generation";
import { buildLongTextInputs, chooseGroupPauses } from "./voice-longtext-plan";
import { VoiceLongTextResultSchema, type VoiceLongTextResult } from "./voice-longtext-result";
import { VoiceRecognitionSchema, isCuttingOnlyRecognition, type VoiceRecognition } from "./voice-recognition";
import { getVoiceReviewWarning, getVoiceContentDifferenceWarning } from "./voice-review-warning";
import { flattenClips } from "./view-model";
import { withVoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
import { getLocalStorageError } from "./local-storage-error";
import { getParagraphGroup, getSpeechWorkspaceMode } from "./speech-workspace";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { VoiceParagraphResultSchema, type VoiceParagraphResult } from "./voice-paragraph-result";
import { paragraphPcmFrames, sliceParagraphPcmWav, splitVoiceParagraph, type ParagraphAudioSegment } from "./voice-paragraph-split";
import type { VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";
import { forceAlignVoiceAudio, validateForcedVoiceAlignment } from "./voice-forced-alignment";
import { ForcedSegmentationSchema, type ForcedSegmentationAlignment } from "./voice-forced-segmentation";

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
async function findOriginalSources(input: RecheckInput, candidate: AudioCandidate, check: () => void,
  indices: readonly number[]): Promise<Map<number, SavedSource>> {
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
        for (const group of prior.groups.filter(group => indices.includes(group.index))) {
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
  if (indices.some(index => matches[index].length !== 1)) throw sourceUnavailable();
  return new Map(indices.map(index => [index, matches[index][0]]));
}

async function findOriginals(input: RecheckInput, candidate: AudioCandidate, check: () => void): Promise<SavedSource[]> {
  const indices = candidate.provenance.longText!.groups.map(group => group.index);
  const sources = await findOriginalSources(input, candidate, check, indices);
  return indices.map(index => sources.get(index)!);
}

function withoutForcedReceipt(provenance: AudioCandidate["provenance"]): AudioCandidate["provenance"] {
  const { forcedSegmentation: _forced, ...rest } = provenance;
  void _forced;
  return rest;
}

function differenceWarning(group: VoiceLongTextResult["groups"][number]) {
  const comparison = group.recognition?.contentComparison;
  return comparison ? getVoiceContentDifferenceWarning(group.index, comparison)
    : `第 ${group.index + 1} 段：已截取目标片段；识别结果与源文有差异（相似度 0.0%），请试听确认。`;
}
function retainedWarnings(candidate: AudioCandidate) {
  const prior = candidate.provenance.longText!;
  const analysisWarnings = new Set([FULL_SOURCE_WARNING, JOIN_WARNING, FORCED_WARNING]);
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

const PARAGRAPH_REVIEW_WARNING = "整段已生成，但短句切分未全部通过检查；完整原音可试听、下载，确认安全分段后才能采用到短句。";
const PARAGRAPH_CONFIRMATION_WARNING = "短句音频已安全切分，部分文字待试听确认；请逐句确认后采用整段。";

/** Reuse only the exact original asset bound by the saved authoritative candidate. */
async function recheckParagraph(input: RecheckInput, candidate: AudioCandidate, dependencies: Dependencies,
  signal: AbortSignal, deadline: number, check: () => void, runtimeSession: VoxCpm2RuntimeSession): Promise<{ candidate: AudioCandidate }> {
  const prior = candidate.provenance.paragraph!;
  const group = getParagraphGroup(input.project, input.clipId);
  const context = getVoiceParagraphContext(input.project, input.clipId);
  const clip = group.find((member) => member.id === input.clipId);
  if (getSpeechWorkspaceMode(input.project) !== "paragraph") throw new VoiceCandidateRecheckError("请切换到整段工作区后重新识别。", 400);
  if (!clip || !context || group.some((member) => member.kind === "silent")
    || context.groupId !== prior.groupId || context.text !== prior.text
    || !isDeepStrictEqual(group.map((member) => member.id), prior.clipIds)
    || candidate.sourceFingerprint !== getVoiceCandidateSourceFingerprint(clip, undefined, context)) {
    throw new VoiceCandidateRecheckError("当前整段台词或短句划分已改变，请重新生成；原候选仍保留。", 409);
  }
  const ownership = group.map((member) => ({ config: input.config, projectId: candidate.projectId, clipId: member.id,
    adoptedAssetId: member.asset.asset_id ?? undefined, workspaceMode: "paragraph" as const }));
  const checkSourceContext = () => {
    if (getSpeechWorkspaceMode(input.project) !== "paragraph"
      || !isDeepStrictEqual(getVoiceParagraphContext(input.project, input.clipId), context)) {
      throw new VoiceCandidateRecheckError("当前整段台词或短句划分已改变，请重新生成；原候选仍保留。", 409);
    }
  };
  for (const owner of ownership) { check(); await ensureAudioCandidateCapacity(owner); }
  let wav: Uint8Array;
  try {
    const filePath = resolveClipAssetPath(prior.sourceAsset.assetId, input.config);
    await safeFile(filePath, input.config.clipAssetRoot, MAX_RECORDING_BYTES);
    wav = new Uint8Array(await readFile(filePath));
    await safeFile(filePath, input.config.clipAssetRoot, MAX_RECORDING_BYTES);
    const { frames } = paragraphPcmFrames(wav);
    if (Math.abs(frames / 48_000 - prior.sourceAsset.duration) > 1 / 48_000
      || candidate.wav.sampleRate !== 48_000 || candidate.wav.channels !== 1 || candidate.wav.bitsPerSample !== 16) throw sourceUnavailable();
  } catch { throw sourceUnavailable(); }
  check();
  const now = dependencies.now ?? new Date();
  const traceRoot = path.join(getVoiceGenerationRoot(input.config), "long-text", randomUUID());
  await mkdir(traceRoot, { recursive: true });
  const record = (name: string, value: unknown) => writeFile(path.join(traceRoot, name), JSON.stringify(value, null, 2), { flag: "wx" });
  // A separate trace documents this analysis attempt. The source asset identity,
  // complete PCM and original native parameters are retained without another TTS.
  await record("plan.json", { projectId: candidate.projectId, clipId: input.clipId, createdAt: now.toISOString(), generationMode: "paragraph",
    sourceFingerprint: candidate.sourceFingerprint, paragraph: context, plan: { clauses: group.map((member) => member.text) },
    targets: [{ expectedText: context.text, text: context.text }], recheckedFromCandidateId: candidate.candidateId,
    sourceAsset: prior.sourceAsset, generationCalls: 0, recheckCalls: 1, originalNativeParameters: candidate.provenance.parameters });
  await writeFile(path.join(traceRoot, "group-1-take-1-source.wav"), wav, { flag: "wx" });
  await record("group-1-take-1-source.json", { ...candidate.provenance, recheckedFromCandidateId: candidate.candidateId,
    generationCalls: 0, recheckCalls: 1 });
  try {
    let cuts: ParagraphAudioSegment[] = [];
    let diagnosticCode: string | undefined;
    let failureRecognition: VoiceRecognition | undefined;
    let failedClipId: string | undefined;
    let attemptedSentence: { text: string; followingText: string } | undefined;
    try {
      cuts = await splitVoiceParagraph({ wav, targets: group.map((member) => ({ clipId: member.id, text: member.text })), config: input.config, signal },
        { runtimeSession, analyze: async (analysisInput, analysisDependencies) => {
          attemptedSentence = { text: analysisInput.expectedText, followingText: analysisInput.followingText ?? "" };
          return (dependencies.analyze ?? analyzeVoiceGroup)(analysisInput,
            { ...analysisDependencies, timeoutMs: Math.max(1, deadline - Date.now()) });
        } });
      check();
    } catch (error) {
      check();
      if (!(error instanceof VoiceGroupAnalysisError) || error.statusCode !== 422) throw error;
      diagnosticCode = error.diagnosticCode ?? "paragraph_analysis_unavailable";
      const evidence = VoiceRecognitionSchema.safeParse(error.recognition);
      if (evidence.success && evidence.data.expectedText === attemptedSentence?.text
        && (evidence.data.followingText ?? "") === attemptedSentence.followingText) {
        const matches = group.filter((member, index) => member.text === evidence.data.expectedText
          && (evidence.data.followingText ?? "") === group.slice(index + 1).map((later) => later.text).join(""));
        if (matches.length === 1) { failureRecognition = evidence.data; failedClipId = matches[0].id; }
      }
      await record("group-1-take-1-failure.json", { stage: "analyze", code: diagnosticCode, message: error.message,
        ...(failureRecognition ? { recognition: failureRecognition, failedClipId } : {}), retainedOriginal: true,
        generationCalls: 0, recheckCalls: 1 });
    }
    check();
    checkSourceContext();
    if (!isDeepStrictEqual(await getAudioCandidate({ config: input.config, candidateId: candidate.candidateId }), candidate)) {
      throw new VoiceCandidateRecheckError("原候选状态已改变，请刷新列表。", 409);
    }
    for (const owner of ownership) { check(); await ensureAudioCandidateCapacity(owner); }
    const segments: VoiceParagraphResult["segments"] = [];
    for (const cut of cuts) {
      check();
      const asset = await saveClipAsset({ config: input.config, clipId: cut.clipId, wav: cut.wav, duration: cut.cutEndSeconds - cut.cutStartSeconds, now });
      segments.push({ clipId: cut.clipId, text: cut.text, asset, cutStartSeconds: cut.cutStartSeconds, cutEndSeconds: cut.cutEndSeconds,
        ...(cut.recognition ? { recognition: cut.recognition } : {}), ...(cut.textReview ? { textReview: cut.textReview } : {}) });
    }
    const paragraph = VoiceParagraphResultSchema.parse({ version: 1, groupId: context.groupId, text: context.text,
      clipIds: group.map((member) => member.id), sourceAsset: prior.sourceAsset, checkStatus: cuts.length ? "passed" : "review", segments,
      ...(diagnosticCode ? { diagnosticCode } : {}), ...(failureRecognition ? { failureRecognition, failedClipId } : {}) });
    const priorWarnings = new Set([PARAGRAPH_REVIEW_WARNING, PARAGRAPH_CONFIRMATION_WARNING, FORCED_WARNING,
      "短句音频已安全切分，但极短句识别漏了句尾语气词；请逐句试听确认后采用整段。",
      ...prior.segments.filter((segment) => segment.recognition?.contentComparison?.status === "different")
        .map((segment) => `「${segment.text}」识别文字有差异，请试听确认。`)]);
    const warnings = [...candidate.qualityWarnings.filter((warning) => !priorWarnings.has(warning)),
      ...(paragraph.checkStatus === "review" ? [PARAGRAPH_REVIEW_WARNING] : []),
      ...segments.filter((segment) => segment.recognition?.contentComparison?.status === "different")
        .map((segment) => `「${segment.text}」识别文字有差异，请试听确认。`)];
    const provenance = { ...withoutForcedReceipt(candidate.provenance), paragraph, parameters: { ...candidate.provenance.parameters,
      recheckedFromCandidateId: candidate.candidateId, recheckedAt: now.toISOString(), generationCalls: 0, recheckCalls: 1 } };
    const candidates = (paragraph.checkStatus !== "review" ? group : [clip]).map((member) => {
      const sourceFingerprint = getVoiceCandidateSourceFingerprint(member, undefined, context);
      return AudioCandidateSchema.parse({ ...candidate, candidateId: `vox_${randomUUID().replaceAll("-", "")}`, clipId: member.id,
        sourceFingerprint, requestFingerprint: JSON.stringify({ source: sourceFingerprint,
          sourceRequestFingerprintHash: createHash("sha256").update(candidate.requestFingerprint).digest("hex"),
          recheckedFromCandidateId: candidate.candidateId, recheckedAt: now.toISOString() }),
        asset: segments.find((segment) => segment.clipId === member.id)?.asset ?? prior.sourceAsset, provenance,
        qualityWarnings: [...new Set(warnings)], createdAt: now.toISOString(), status: "ready" });
    });
    await record("group-1-take-1-analysis.json", { checkStatus: paragraph.checkStatus, diagnosticCode, segments,
      ...(failureRecognition ? { failureRecognition, failedClipId } : {}), generationCalls: 0, recheckCalls: 1 });
    await record("result.json", paragraph);
    check();
    checkSourceContext();
    await saveParagraphAudioCandidates({ config: input.config, candidates, signal, sourceCandidate: candidate,
      adoptedAssetIds: Object.fromEntries(ownership.map((owner) => [owner.clipId, owner.adoptedAssetId])) });
    return { candidate: candidates.find((item) => item.clipId === input.clipId)! };
  } catch (error) {
    await record("failure.json", { message: error instanceof Error ? error.message : "重新识别未完成", cancelled: signal.aborted,
      retainedOriginal: true, generationCalls: 0, recheckCalls: 1 }).catch(() => undefined);
    throw error;
  }
}

export async function recheckVoiceCandidate(input: RecheckInput, dependencies: Dependencies = {}): Promise<{ candidate: AudioCandidate }> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let deadline = startedAt + (dependencies.timeoutMs ?? 300_000);
  const cancelled = new VoiceCandidateRecheckError("重新识别已取消，原候选仍保留。", 499);
  const abort = () => controller.abort(cancelled);
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const onTimeout = () => controller.abort(new VoiceCandidateRecheckError("重新识别超时，原候选仍保留，请稍后重试。", 504));
  let timeout = setTimeout(onTimeout, dependencies.timeoutMs ?? 300_000);
  const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  try {
    check();
    const candidate = await getAudioCandidate({ config: input.config, candidateId: input.candidateId });
    check();
    const clip = flattenClips(input.project).find((item) => item.id === input.clipId);
    if (!candidate || candidate.status !== "ready" || candidate.projectId !== input.project.project_id
      || candidate.clipId !== input.clipId || clip?.type !== "voice") {
      throw new VoiceCandidateRecheckError("此候选已不可用或不属于当前片段，请刷新列表。", 404);
    }
    if (candidate.provenance.generationMode === "paragraph" && candidate.provenance.paragraph) {
      // A paragraph verifies every successive sentence and boundary. Select its
      // larger budget only from the authoritative saved mode, never client hints.
      if (dependencies.timeoutMs === undefined) {
        clearTimeout(timeout);
        deadline = startedAt + 30 * 60 * 1_000;
        timeout = setTimeout(onTimeout, Math.max(1, deadline - Date.now()));
      }
      return await withVoxCpm2RuntimeSession(input.config, controller.signal, (runtimeSession) =>
        recheckParagraph(input, candidate, dependencies, controller.signal, deadline, check, runtimeSession));
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
              analysisMode: "cutting_only" as const, stage: "unavailable" as const, sourceTranscript: "", expectedText: target.expectedText,
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
        const { recognition: _oldRecognition, diagnosticCode: _oldCode, internalPausePositions: _oldPositions, segmentationMethod: _oldMethod, ...oldGroup } = prior.groups[index];
        void _oldRecognition; void _oldCode; void _oldPositions; void _oldMethod;
        const analysis = measuredGroup.analysis;
        const group = { ...oldGroup, asset, internalPausesMs: analysis?.internalPausesMs ?? [],
          internalPauseClasses: prior.plan ? prior.plan.clausePauseClasses.slice(prior.plan.groups[index].start, prior.plan.groups[index].end)
            : oldGroup.internalPauseClasses,
          ...(isCuttingOnlyRecognition(measuredGroup.recognition) && analysis?.boundaryOnly ? {
            internalPausePositions: analysis.boundaryOnly.internalPausePositions,
            internalPauseClasses: analysis.boundaryOnly.internalPausePositions.map(position => {
              const plan = prior.plan;
              return plan ? plan.clausePauseClasses[plan.groups[index].start + position] : oldGroup.internalPauseClasses[position];
            }),
          } : {}),
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
        provenance: { ...withoutForcedReceipt(candidate.provenance), parameters: { ...candidate.provenance.parameters,
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

type ForceSplitDependencies = { forceAlign?: typeof forceAlignVoiceAudio; timeoutMs?: number; now?: Date };
const FORCED_WARNING = "已强制切分，请试听后决定是否采用。台词内容未核验。";
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

/** Explicit CTC timing of the exact saved original; never an automatic adoption. */
export async function forceSplitVoiceCandidate(input: RecheckInput, dependencies: ForceSplitDependencies = {}): Promise<{ candidate: AudioCandidate }> {
  const controller = new AbortController();
  const cancelled = new VoiceCandidateRecheckError("强制切分已取消，原候选仍保留。", 499);
  const abort = () => controller.abort(cancelled);
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const budget = dependencies.timeoutMs ?? 30 * 60_000, deadline = Date.now() + budget;
  const timer = setTimeout(() => controller.abort(new VoiceCandidateRecheckError("强制切分超时，原候选仍保留。", 504)), budget);
  const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
  let traceRoot: string | undefined;
  try {
    check();
    const candidate = await getAudioCandidate({ config: input.config, candidateId: input.candidateId });
    const clip = flattenClips(input.project).find(member => member.id === input.clipId);
    if (!candidate || candidate.status !== "ready" || candidate.projectId !== input.project.project_id
      || candidate.clipId !== input.clipId || clip?.type !== "voice" || clip.kind === "silent") {
      throw new VoiceCandidateRecheckError("此候选已不可用或不属于当前片段，请刷新列表。", 404);
    }
    if (candidate.provenance.forcedSegmentation) throw new VoiceCandidateRecheckError("此候选已经强制切分，请试听后决定是否采用。", 400);
    const paragraph = candidate.provenance.paragraph, prior = candidate.provenance.longText;
    const isParagraph = candidate.provenance.generationMode === "paragraph";
    if (isParagraph ? paragraph?.checkStatus !== "review"
      : candidate.provenance.generationMode !== "long_text" || !prior?.plan || !prior.groups.some(group => group.checkStatus === "review")) {
      throw new VoiceCandidateRecheckError("只有自动切分失败且保留完整原音的候选可以强制切分。", 400);
    }
    const context = isParagraph ? getVoiceParagraphContext(input.project, clip.id) : undefined;
    const generationContext = isParagraph ? undefined : getVoiceGenerationContext(input.project, clip.id);
    const members = isParagraph ? getParagraphGroup(input.project, clip.id) : [clip];
    const checkContext = () => {
      const activeClip = flattenClips(input.project).find(member => member.id === clip.id);
      if (activeClip?.type !== "voice" || activeClip.kind === "silent") throw new VoiceCandidateRecheckError("当前片段已改变，原候选仍保留。", 409);
      if (isParagraph) {
        if (!context || !paragraph || getSpeechWorkspaceMode(input.project) !== "paragraph"
          || members.some(member => member.kind === "silent") || !isDeepStrictEqual(getVoiceParagraphContext(input.project, clip.id), context)
          || context.groupId !== paragraph.groupId || context.text !== paragraph.text
          || !isDeepStrictEqual(members.map(member => member.id), paragraph.clipIds)
          || candidate.sourceFingerprint !== getVoiceCandidateSourceFingerprint(activeClip, undefined, context)) {
          throw new VoiceCandidateRecheckError("当前整段台词或短句划分已改变，请重新生成；原候选仍保留。", 409);
        }
      } else if (!prior?.plan || getSpeechWorkspaceMode(input.project) !== "short"
        || !isDeepStrictEqual(getVoiceGenerationContext(input.project, clip.id), generationContext)
        || !isDeepStrictEqual(prior.context, generationContext) || prior.plan.clauses.join("") !== activeClip.text.trim()
        || candidate.sourceFingerprint !== getVoiceCandidateSourceFingerprint(activeClip, generationContext)) {
        throw new VoiceCandidateRecheckError("当前台词或后续语境已改变，请重新生成；原候选仍保留。", 409);
      }
    };
    checkContext();
    const owners = members.map(member => ({ config: input.config, projectId: candidate.projectId, clipId: member.id,
      adoptedAssetId: member.asset.asset_id ?? undefined, workspaceMode: isParagraph ? "paragraph" as const : "short" as const }));
    for (const owner of owners) { check(); await ensureAudioCandidateCapacity(owner); }
    return await withVoxCpm2RuntimeSession(input.config, controller.signal, async runtimeSession => {
      const sourceSnapshots = new Map<string, { root: string; sha: string }>();
      const readSource = async (filePath: string, root: string) => {
        await safeFile(filePath, root, MAX_RECORDING_BYTES);
        const wav = new Uint8Array(await readFile(filePath));
        try { paragraphPcmFrames(wav); } catch { throw sourceUnavailable(); }
        sourceSnapshots.set(filePath, { root, sha: sha256(wav) });
        return wav;
      };
      const checkSources = async () => {
        check(); checkContext();
        if (!isDeepStrictEqual(await getAudioCandidate({ config: input.config, candidateId: candidate.candidateId }), candidate)) {
          throw new VoiceCandidateRecheckError("原候选状态已改变，请刷新列表。", 409);
        }
        for (const [filePath, snapshot] of sourceSnapshots) {
          check(); await safeFile(filePath, snapshot.root, MAX_RECORDING_BYTES);
          if (sha256(await readFile(filePath)) !== snapshot.sha) throw new VoiceCandidateRecheckError("完整原音已改变，原候选仍保留。", 409);
        }
      };
      const now = dependencies.now ?? new Date();
      traceRoot = path.join(getVoiceGenerationRoot(input.config), "long-text", randomUUID());
      await mkdir(traceRoot, { recursive: true });
      const record = (name: string, value: unknown) => writeFile(path.join(traceRoot!, name), JSON.stringify(value, null, 2), { flag: "wx" });
      const alignments: ForcedSegmentationAlignment[] = [];
      const align = async (wav: Uint8Array, clauses: string[], inputText: string, mode: "paragraph" | "prefix") => {
        check();
        const request = { wav, clauses, inputText: inputText.trim(), mode, config: input.config, signal: controller.signal };
        const result = await (dependencies.forceAlign ?? forceAlignVoiceAudio)(request,
          { runtimeSession, timeoutMs: Math.max(1, deadline - Date.now()) });
        check();
        return validateForcedVoiceAlignment(result, request);
      };
      const receipt = () => ForcedSegmentationSchema.parse({ version: 1, method: "ctc_forced", sourceCandidateId: candidate.candidateId,
        createdAt: now.toISOString(), contentVerified: false, alignments });
      if (isParagraph && paragraph && context) {
        const sourcePath = resolveClipAssetPath(paragraph.sourceAsset.assetId, input.config);
        const wav = await readSource(sourcePath, input.config.clipAssetRoot), { frames } = paragraphPcmFrames(wav);
        if (Math.abs(frames / 48_000 - paragraph.sourceAsset.duration) > 1 / 48_000) throw sourceUnavailable();
        await record("plan.json", { projectId: candidate.projectId, clipId: clip.id, createdAt: now.toISOString(), generationMode: "paragraph",
          sourceFingerprint: candidate.sourceFingerprint, paragraph: context, plan: { clauses: members.map(member => member.text) },
          targets: [{ expectedText: context.text, text: context.text }], sourceAsset: paragraph.sourceAsset,
          forcedFromCandidateId: candidate.candidateId, generationCalls: 0 });
        await writeFile(path.join(traceRoot!, "group-1-take-1-source.wav"), wav, { flag: "wx" });
        await record("group-1-take-1-source.json", candidate.provenance);
        if (members.length === 1) alignments.push({ groupIndex: 0, sourceAssetId: paragraph.sourceAsset.assetId, method: "whole_recording",
          sourceSha256: sha256(wav), inputTextSha256: sha256(context.text.trim()), sampleRate: 48_000, sourceFrames: frames,
          cutFrames: [], contentVerified: false, ...(paragraph.failureRecognition ? { previousRecognition: paragraph.failureRecognition } : {}),
          ...(paragraph.failedClipId ? { failedClipId: paragraph.failedClipId } : {}) });
        else alignments.push({ ...await align(wav, members.map(member => member.text), context.text, "paragraph"),
          groupIndex: 0, sourceAssetId: paragraph.sourceAsset.assetId,
          ...(paragraph.failureRecognition ? { previousRecognition: paragraph.failureRecognition } : {}),
          ...(paragraph.failedClipId ? { failedClipId: paragraph.failedClipId } : {}) });
        await checkSources();
        const boundaries = [0, ...alignments[0].cutFrames, frames];
        const segments: VoiceParagraphResult["segments"] = [];
        for (const [index, member] of members.entries()) {
          check();
          const start = boundaries[index], end = boundaries[index + 1];
          const asset = await saveClipAsset({ config: input.config, clipId: member.id,
            wav: sliceParagraphPcmWav(wav, start, end), duration: (end - start) / 48_000, now });
          segments.push({ clipId: member.id, text: member.text, asset, cutStartSeconds: start / 48_000, cutEndSeconds: end / 48_000 });
        }
        const result = VoiceParagraphResultSchema.parse({ version: 1, groupId: paragraph.groupId, text: paragraph.text,
          clipIds: paragraph.clipIds, sourceAsset: paragraph.sourceAsset, checkStatus: "passed", segments });
        const forcedSegmentation = receipt();
        const provenance = { ...candidate.provenance, paragraph: result, forcedSegmentation,
          parameters: { ...candidate.provenance.parameters, forcedFromCandidateId: candidate.candidateId, generationCalls: 0, forcedSplitCalls: 1 } };
        const candidates = members.map(member => AudioCandidateSchema.parse({ ...candidate,
          candidateId: `vox_${randomUUID().replaceAll("-", "")}`, clipId: member.id,
          sourceFingerprint: getVoiceCandidateSourceFingerprint(member, undefined, context),
          requestFingerprint: JSON.stringify({ forcedFromCandidateId: candidate.candidateId, method: "ctc_forced", at: now.toISOString() }),
          asset: segments.find(segment => segment.clipId === member.id)!.asset, provenance, status: "ready", createdAt: now.toISOString(),
          qualityWarnings: [...candidate.qualityWarnings.filter(warning => ![PARAGRAPH_REVIEW_WARNING, PARAGRAPH_CONFIRMATION_WARNING].includes(warning)), FORCED_WARNING] }));
        await record("forced-segmentation.json", forcedSegmentation);
        await record("group-1-take-1-analysis.json", { checkStatus: "passed", segments, forcedSegmentation, generationCalls: 0 });
        await record("result.json", result);
        await checkSources();
        await saveParagraphAudioCandidates({ config: input.config, candidates, signal: controller.signal, sourceCandidate: candidate,
          adoptedAssetIds: Object.fromEntries(owners.map(owner => [owner.clipId, owner.adoptedAssetId])) });
        return { candidate: candidates.find(item => item.clipId === clip.id)! };
      }
      if (!prior?.plan) throw sourceUnavailable();
      const targets = buildLongTextInputs(prior.plan, prior.context);
      if (targets.length !== prior.groups.length || targets.some((target, index) => target.expectedText !== prior.groups[index].text
        || target.text !== prior.groups[index].inputText || target.isFinal !== prior.groups[index].isFinal
        || !isDeepStrictEqual(target.paddingClauses, prior.groups[index].paddingClauses))) {
        throw new VoiceCandidateRecheckError("此候选的分组语境已失效，请重新生成。", 409);
      }
      const indices = prior.groups.filter(group => group.checkStatus === "review").map(group => group.index);
      const originals = await findOriginalSources(input, candidate, check, indices);
      await record("plan.json", { projectId: candidate.projectId, clipId: clip.id, sourceFingerprint: candidate.sourceFingerprint,
        plan: prior.plan, targets, ...(prior.context ? { context: prior.context } : {}), createdAt: now.toISOString(),
        forcedFromCandidateId: candidate.candidateId, generationCalls: 0 });
      const groups: VoiceLongTextResult["groups"] = [], audio: Array<{ wav: Uint8Array; leadingQuietMs: number; trailingQuietMs: number }> = [];
      for (const [index, group] of prior.groups.entries()) {
        check();
        if (group.checkStatus !== "review") {
          const wav = await readSource(resolveClipAssetPath(group.asset.assetId, input.config), input.config.clipAssetRoot);
          if (Math.abs(paragraphPcmFrames(wav).frames / 48_000 - group.asset.duration) > 1 / 48_000) throw sourceUnavailable();
          groups.push(group); audio.push({ wav, leadingQuietMs: group.leadingQuietMs, trailingQuietMs: group.trailingQuietMs });
          continue;
        }
        const original = originals.get(index)!, target = targets[index];
        const wav = await readSource(original.wavPath, path.dirname(original.wavPath)), { frames } = paragraphPcmFrames(wav);
        const inputText = group.inputText.trim();
        const alignment: ForcedSegmentationAlignment = target.isFinal
          ? { groupIndex: index, sourceAssetId: group.asset.assetId, method: "whole_recording", sourceSha256: sha256(wav),
            inputTextSha256: sha256(inputText), sampleRate: 48_000, sourceFrames: frames, cutFrames: [], contentVerified: false,
            ...(group.recognition ? { previousRecognition: group.recognition } : {}) }
          : { ...await align(wav, [target.expectedText], inputText, "prefix"), groupIndex: index, sourceAssetId: group.asset.assetId,
            ...(group.recognition ? { previousRecognition: group.recognition } : {}) };
        alignments.push(alignment);
        const end = alignment.method === "whole_recording" ? frames : alignment.cutFrames[0];
        const cropped = sliceParagraphPcmWav(wav, 0, end);
        const asset = await saveClipAsset({ config: input.config, clipId: `${clip.id}_group_${index + 1}`, wav: cropped, duration: end / 48_000, now });
        const { diagnosticCode: _diagnostic, ...retained } = group; void _diagnostic;
        groups.push({ ...retained, asset, cutStartSeconds: 0, cutEndSeconds: end / 48_000, checkStatus: "passed",
          segmentationMethod: alignment.method, internalPausesMs: [], internalPauseClasses: [], internalPausePositions: [], leadingQuietMs: 0, trailingQuietMs: 0 });
        audio.push({ wav: cropped, leadingQuietMs: 0, trailingQuietMs: 0 });
        // Only changed groups get a new source trace. Unchanged assets keep their
        // original unique ownership instead of acquiring a duplicate source.
        const prefix = `group-${index + 1}-take-1`;
        await writeFile(path.join(traceRoot!, `${prefix}-source.wav`), wav, { flag: "wx" });
        await writeFile(path.join(traceRoot!, `${prefix}-source.json`), await readFile(original.metadataPath), { flag: "wx" });
        await record(`${prefix}-analysis.json`, { checkStatus: "passed", segmentationMethod: alignment.method,
          recognition: group.recognition, forcedAlignment: alignment, cutStartSeconds: 0, cutEndSeconds: end / 48_000, generationCalls: 0 });
      }
      await checkSources();
      const assembled = assembleVoiceGroups(audio, chooseGroupPauses(groups));
      const longText = VoiceLongTextResultSchema.parse({ ...prior, groups, joins: assembled.joins, loudnessGainDb: assembled.loudnessGainDb });
      const forcedSegmentation = receipt();
      await record("forced-segmentation.json", forcedSegmentation);
      await record("groups.json", groups); await record("result.json", longText);
      await writeFile(path.join(traceRoot!, "assembled.wav"), assembled.wav, { flag: "wx" });
      const asset = await saveClipAsset({ config: input.config, clipId: clip.id, wav: assembled.wav,
        duration: paragraphPcmFrames(assembled.wav).frames / 48_000, now });
      const result = AudioCandidateSchema.parse({ ...candidate, candidateId: `vox_${randomUUID().replaceAll("-", "")}`, asset,
        requestFingerprint: JSON.stringify({ forcedFromCandidateId: candidate.candidateId, method: "ctc_forced", at: now.toISOString() }),
        provenance: { ...candidate.provenance, longText, forcedSegmentation,
          parameters: { ...candidate.provenance.parameters, forcedFromCandidateId: candidate.candidateId, generationCalls: 0, forcedSplitCalls: 1 } },
        qualityWarnings: [...retainedWarnings(candidate), FORCED_WARNING], createdAt: now.toISOString(), status: "ready" });
      await checkSources();
      await saveAudioCandidate({ config: input.config, candidate: result, adoptedAssetId: owners[0].adoptedAssetId,
        signal: controller.signal, sourceCandidate: candidate });
      return { candidate: result };
    });
  } catch (error) {
    if (traceRoot) await writeFile(path.join(traceRoot, "forced-failure.json"), JSON.stringify({
      cancelled: controller.signal.aborted, retainedOriginal: true,
      code: error instanceof Error && "diagnosticCode" in error ? error.diagnosticCode : "force_split_failed" }), { flag: "wx" }).catch(() => undefined);
    check();
    if (error instanceof CandidateSourceChangedError) throw new VoiceCandidateRecheckError(error.message, error.statusCode);
    if (error instanceof VoiceCandidateRecheckError) throw error;
    const storage = getLocalStorageError(error); if (storage) throw storage;
    if (error instanceof Error && "statusCode" in error) throw error;
    throw new VoiceCandidateRecheckError("强制切分未能完成，原候选仍保留。", 500);
  } finally {
    clearTimeout(timer); input.signal?.removeEventListener("abort", abort);
  }
}
