import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { resolveClipAssetPath } from "./local-asset-store";
import { CandidateSourceChangedError, confirmParagraphAudioCandidates, getAudioCandidate, listAudioCandidates } from "./local-candidate-store";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import type { AsmrProject } from "./schema";
import { getParagraphGroup, getSpeechWorkspaceMode } from "./speech-workspace";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { getVoiceParagraphReviewClipIds } from "./voice-paragraph-result";
import { paragraphPcmFrames } from "./voice-paragraph-split";
import { MAX_RECORDING_BYTES } from "./voice-generation-recordings";

export class VoiceParagraphConfirmationError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); this.name = "VoiceParagraphConfirmationError"; }
}
type Input = { project: AsmrProject; clipId: string; candidateId: string; confirmedClipIds: string[];
  config: LocalRuntimeConfig; signal?: AbortSignal; now?: Date };

async function assetBytes(assetId: string, config: LocalRuntimeConfig, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const filePath = resolveClipAssetPath(assetId, config), info = await lstat(filePath);
  const relative = path.relative(await realpath(config.clipAssetRoot), await realpath(filePath));
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_RECORDING_BYTES
    || !relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Original audio unavailable");
  const wav = new Uint8Array(await readFile(filePath));
  signal?.throwIfAborted();
  return wav;
}

/** Confirm saved safe slices; this path never runs recognition or generation. */
export async function confirmVoiceParagraphText(input: Input): Promise<{ candidate: AudioCandidate; candidates: AudioCandidate[] }> {
  input.signal?.throwIfAborted();
  const candidate = await getAudioCandidate({ config: input.config, candidateId: input.candidateId });
  if (!candidate || candidate.status !== "ready" || candidate.projectId !== input.project.project_id || candidate.clipId !== input.clipId) {
    throw new VoiceParagraphConfirmationError("此候选已不可用或不属于当前片段，请刷新列表。", 404);
  }
  const paragraph = candidate.provenance.paragraph;
  if (candidate.provenance.generationMode !== "paragraph" || !paragraph || paragraph.checkStatus !== "needs_confirmation") {
    throw new VoiceParagraphConfirmationError("只有已安全切分且待试听确认的整段候选可确认。", 400);
  }
  if (getSpeechWorkspaceMode(input.project) !== "paragraph") throw new VoiceParagraphConfirmationError("请切换到整段工作区后试听确认。", 400);
  const group = getParagraphGroup(input.project, input.clipId), context = getVoiceParagraphContext(input.project, input.clipId);
  const matchesSource = () => Boolean(context && getSpeechWorkspaceMode(input.project) === "paragraph"
    && isDeepStrictEqual(getVoiceParagraphContext(input.project, input.clipId), context)
    && context.groupId === paragraph.groupId && context.text === paragraph.text
    && isDeepStrictEqual(group.map((member) => member.id), paragraph.clipIds)
    && group.every((member, index) => member.kind !== "silent" && member.text === paragraph.segments[index]?.text));
  if (!matchesSource()) throw new VoiceParagraphConfirmationError("整段台词或短句划分已修改，请重新识别后确认。", 409);
  const reviewIds = getVoiceParagraphReviewClipIds(paragraph);
  if (!reviewIds.length || !isDeepStrictEqual(input.confirmedClipIds, reviewIds)) {
    throw new VoiceParagraphConfirmationError("请逐句试听并确认所有有识别差异的短句。", 400);
  }
  const siblings = (await listAudioCandidates({ config: input.config, projectId: candidate.projectId, workspaceMode: "paragraph", includeDiscarded: true }))
    .filter((item) => isDeepStrictEqual(item.provenance.paragraph, paragraph));
  if (siblings.length !== group.length || group.some((member) => {
    const owned = siblings.filter((item) => item.clipId === member.id);
    return owned.length !== 1 || owned[0].status !== "ready"
      || owned[0].sourceFingerprint !== getVoiceCandidateSourceFingerprint(member, undefined, context);
  })) throw new VoiceParagraphConfirmationError("整段候选成员或文案已改变，请刷新列表。", 409);
  try {
    const source = paragraphPcmFrames(await assetBytes(paragraph.sourceAsset.assetId, input.config, input.signal));
    if (Math.abs(source.frames / 48_000 - paragraph.sourceAsset.duration) > 1 / 48_000) throw new Error("Invalid original duration");
    for (const segment of paragraph.segments) {
      const cut = paragraphPcmFrames(await assetBytes(segment.asset.assetId, input.config, input.signal));
      const start = Math.round(segment.cutStartSeconds * 48_000), end = Math.round(segment.cutEndSeconds * 48_000);
      if (cut.frames !== end - start || !Buffer.from(cut.pcm).equals(Buffer.from(source.pcm.subarray(start * 2, end * 2)))) throw new Error("Changed slice bytes");
    }
  } catch (error) {
    input.signal?.throwIfAborted();
    if (error instanceof VoiceParagraphConfirmationError) throw error;
    throw new VoiceParagraphConfirmationError("完整原音或短句音频已不可用，确认未保存；请重新识别。", 422);
  }
  input.signal?.throwIfAborted();
  if (!matchesSource()) throw new VoiceParagraphConfirmationError("整段台词已改变，确认未保存。", 409);
  try {
    const candidates = await confirmParagraphAudioCandidates({ config: input.config, sourceCandidate: candidate,
      sourceCandidates: paragraph.clipIds.map((clipId) => siblings.find((item) => item.clipId === clipId)!),
      confirmedClipIds: input.confirmedClipIds, confirmedAt: (input.now ?? new Date()).toISOString(), signal: input.signal });
    return { candidate: candidates.find((item) => item.candidateId === input.candidateId)!, candidates };
  } catch (error) {
    if (error instanceof CandidateSourceChangedError) throw new VoiceParagraphConfirmationError(error.message, error.statusCode);
    throw error;
  }
}
