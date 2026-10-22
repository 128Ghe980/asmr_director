import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { resolveClipAssetPath, saveClipAsset } from "./local-asset-store";
import { discardAudioCandidate, getAudioCandidate, listAudioCandidates, resolveCandidateManifestPath, saveAudioCandidate } from "./local-candidate-store";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { makeVoiceCandidateFixture, makeVoiceLongTextResultFixture } from "./voice-candidate-fixture";
import { forceSplitVoiceCandidate, recheckVoiceCandidate } from "./voice-candidate-recheck";
import { type ForcedVoiceAlignment, type forceAlignVoiceAudio, VoiceForcedAlignmentError } from "./voice-forced-alignment";
import { VoiceGroupAnalysisError } from "./voice-group-analysis";
import { listVoiceGenerationRecordings } from "./voice-generation-recordings";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { paragraphPcmFrames } from "./voice-paragraph-split";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";
import { buildLongTextInputs } from "./voice-longtext-plan";

const roots: string[] = [], runId = "11111111-2222-4333-8444-555555555555";
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function aligned(input: Parameters<typeof forceAlignVoiceAudio>[0], cutFrames = [48_000]): ForcedVoiceAlignment {
  const normalize = (text: string) => Array.from(text).filter(char => !/[\s\p{P}~～]/u.test(char));
  const first = normalize(input.clauses[0]);
  const second = input.mode === "prefix" ? normalize(input.inputText).slice(first.length, first.length + 1)
    : normalize(input.clauses.slice(1).join(""));
  const characters = [...first.map((char, index) => ({ char, startSeconds: .1 + index * .8 / first.length,
    endSeconds: index === first.length - 1 ? .9 : .1 + (index + 1) * .8 / first.length, score: 1e-15 })),
  ...second.map((char, index) => ({ char, startSeconds: 1.1 + index * .8 / second.length,
    endSeconds: 1.1 + (index + 1) * .8 / second.length, score: 0 }))];
  return { method: "ctc_forced", mode: input.mode, sourceSha256: sha(input.wav), inputTextSha256: sha(input.inputText),
    modelId: "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn", modelRevision: "99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd",
    sampleRate: 48_000, sourceFrames: paragraphPcmFrames(input.wav).frames, cutFrames,
    characters, contentVerified: false };
}
async function base() {
  const root = await mkdtemp(path.join(os.tmpdir(), "force-split-test-")); roots.push(root);
  vi.stubEnv("ASMR_VOICE_WORK_ROOT", path.join(root, "voice-work"));
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root });
  const project = structuredClone(demoProject);
  const clips = project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
  const forceAlign = vi.fn<typeof forceAlignVoiceAudio>(async input => aligned(input));
  return { root, config, project, clips, forceAlign, workRoot: path.join(root, "voice-work", "long-text") };
}
async function paragraphFixture() {
  const data = await base();
  data.clips[0].text = "回来啦。"; data.clips[1].text = "先坐。";
  const project = switchSpeechWorkspace(ensureSpeechWorkspaces(data.project), "paragraph");
  project.speechWorkspace!.groups = [{ id: "force-paragraph", clipIds: data.clips.slice(0, 2).map(clip => clip.id) },
    ...data.clips.slice(2).map(clip => ({ id: clip.id, clipIds: [clip.id] }))];
  const context = getVoiceParagraphContext(project, data.clips[0].id)!;
  // Deliberately no quiet at all: an explicit force does not repeat automatic gates.
  const wav = writePcm16Wav(new Float32Array(96_000).fill(.08), 48_000);
  const sourceAsset = await saveClipAsset({ config: data.config, clipId: "force_original", wav, duration: 2 });
  const priorRecognition = { analysisMode: "cutting_only" as const, stage: "boundary_check" as const,
    expectedText: context.clips[0].text, followingText: context.clips[1].text, sourceTranscript: "回来先做" };
  const original = makeVoiceCandidateFixture();
  const candidate = AudioCandidateSchema.parse({ ...original, clipId: data.clips[0].id, asset: sourceAsset,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(data.clips[0], undefined, context),
    provenance: { ...original.provenance, generationMode: "paragraph", paragraph: { version: 1, groupId: context.groupId,
      text: context.text, clipIds: context.clips.map(clip => clip.clipId), sourceAsset, checkStatus: "review", segments: [],
      failedClipId: context.clips[0].clipId, failureRecognition: priorRecognition, diagnosticCode: "no_verified_quiet_cut" } } });
  await saveAudioCandidate({ config: data.config, candidate });
  return { ...data, project, context, wav, candidate, priorRecognition };
}
async function longFixture(finalOnly = false) {
  const data = await base(), longText = makeVoiceLongTextResultFixture();
  data.clips[0].text = longText.plan!.clauses.join(""); delete data.clips[0].semantic_unit;
  const originals = [writePcm16Wav(new Float32Array(144_000).fill(.07), 48_000), writePcm16Wav(new Float32Array(96_000).fill(-.03), 48_000)];
  for (const [index, group] of longText.groups.entries()) {
    group.asset = await saveClipAsset({ config: data.config, clipId: `initial_group_${index}`, wav: originals[index], duration: index ? 2 : 3 });
    group.cutEndSeconds = group.asset.duration;
    group.checkStatus = (finalOnly ? index === 1 : index === 0) ? "review" : "passed";
    if (group.checkStatus === "review") {
      group.internalPausesMs = []; group.diagnosticCode = "no_verified_quiet_cut";
      group.recognition = { analysisMode: "cutting_only", stage: "boundary_check", expectedText: group.text,
        sourceTranscript: "真实旧识别", ...(index === 0 ? { followingText: longText.groups[1].text } : {}) };
    }
  }
  const original = makeVoiceCandidateFixture();
  const candidate = AudioCandidateSchema.parse({ ...original,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(data.clips[0]), provenance: { ...original.provenance, generationMode: "long_text", longText } });
  await saveAudioCandidate({ config: data.config, candidate });
  const targets = buildLongTextInputs(longText.plan!), trace = path.join(data.workRoot, runId);
  await mkdir(trace, { recursive: true });
  await writeFile(path.join(trace, "plan.json"), JSON.stringify({ projectId: candidate.projectId, clipId: candidate.clipId,
    sourceFingerprint: candidate.sourceFingerprint, plan: longText.plan, targets }));
  await writeFile(path.join(trace, "result.json"), JSON.stringify(longText));
  await writeFile(path.join(trace, "groups.json"), JSON.stringify(longText.groups));
  for (const group of longText.groups) {
    const prefix = `group-${group.index + 1}-take-1`;
    await writeFile(path.join(trace, `${prefix}-source.wav`), originals[group.index]);
    await writeFile(path.join(trace, `${prefix}-source.json`), JSON.stringify({ ...original.provenance,
      seed: group.seed, parameters: group.parameters }));
  }
  return { ...data, candidate, longText, originals, targets, trace };
}
const inputFor = (data: Awaited<ReturnType<typeof paragraphFixture>> | Awaited<ReturnType<typeof longFixture>>) => ({
  project: data.project, clipId: data.candidate.clipId, candidateId: data.candidate.candidateId, config: data.config });
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith("force-split-test-")) throw new Error("Unsafe test cleanup");
    await rm(root, { recursive: true, force: true });
  }
});

describe("explicit forced splitting of saved originals", () => {
  it("partitions loud paragraph PCM despite low scores, preserves old ASR evidence, and never adopts", async () => {
    const data = await paragraphFixture(), projectBefore = JSON.stringify(data.project);
    const result = await forceSplitVoiceCandidate(inputFor(data), { forceAlign: data.forceAlign });
    const updated = result.candidate, paragraph = updated.provenance.paragraph!;
    expect(data.forceAlign).toHaveBeenCalledOnce();
    expect(data.forceAlign.mock.calls[0][0]).toMatchObject({ mode: "paragraph", inputText: data.context.text,
      clauses: data.context.clips.map(clip => clip.text), wav: data.wav });
    expect(paragraph.checkStatus).toBe("passed");
    expect(paragraph.failureRecognition).toBeUndefined();
    expect(paragraph.segments.every(segment => !segment.recognition && !segment.textReview)).toBe(true);
    expect(updated.provenance.forcedSegmentation).toMatchObject({ method: "ctc_forced", sourceCandidateId: data.candidate.candidateId,
      contentVerified: false, alignments: [{ previousRecognition: data.priorRecognition, failedClipId: data.context.clips[0].clipId }] });
    const pcm = await Promise.all(paragraph.segments.map(async segment => paragraphPcmFrames(new Uint8Array(await readFile(resolveClipAssetPath(segment.asset.assetId, data.config)))).pcm));
    expect(Buffer.concat(pcm)).toEqual(Buffer.from(paragraphPcmFrames(data.wav).pcm));
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(data.candidate);
    expect(JSON.stringify(data.project)).toBe(projectBefore);
    expect(await readFile(resolveClipAssetPath(paragraph.sourceAsset.assetId, data.config))).toEqual(Buffer.from(data.wav));
    expect(await listAudioCandidates({ config: data.config, projectId: data.project.project_id, workspaceMode: "paragraph" })).toHaveLength(3);
    expect(await readdir(path.join(data.root, "locks"))).toEqual([]);
    const recordings = await listVoiceGenerationRecordings({ config: data.config, projectId: data.project.project_id,
      clipId: data.candidate.clipId, text: data.context.clips[0].text, workspaceMode: "paragraph" });
    expect(recordings.recordings[0].warning).toContain("强制切分");
    expect(recordings.recordings[0].warning).toContain("未核验台词内容");
    await expect(forceSplitVoiceCandidate({ ...inputFor(data), candidateId: updated.candidateId }, { forceAlign: data.forceAlign })).rejects.toMatchObject({ statusCode: 400 });
    expect(data.forceAlign).toHaveBeenCalledOnce();
  });

  it("aligns the full saved padded input only for review groups and preserves successful source ownership", async () => {
    const data = await longFixture();
    const result = await forceSplitVoiceCandidate(inputFor(data), { forceAlign: data.forceAlign });
    expect(data.forceAlign).toHaveBeenCalledOnce();
    expect(data.forceAlign.mock.calls[0][0]).toMatchObject({ mode: "prefix", clauses: [data.targets[0].expectedText],
      inputText: data.longText.groups[0].inputText.trim(), wav: data.originals[0] });
    expect(data.longText.groups[0].paddingClauses.length).toBeGreaterThan(0);
    const updated = result.candidate.provenance.longText!;
    expect(updated.groups[0]).toMatchObject({ checkStatus: "passed", segmentationMethod: "ctc_forced", cutEndSeconds: 1,
      recognition: data.longText.groups[0].recognition, internalPausesMs: [], internalPausePositions: [] });
    expect(updated.groups[1]).toEqual(data.longText.groups[1]);
    const newRun = path.join(data.workRoot, (await readdir(data.workRoot)).find(name => name !== runId)!);
    expect(await readdir(newRun)).not.toContain("group-2-take-1-source.wav");
    expect(await readFile(path.join(data.trace, "group-1-take-1-source.wav"))).toEqual(Buffer.from(data.originals[0]));
    // Ordinary recheck can still locate every unique original after a partial
    // force; its new result has fresh ASR evidence rather than an old force tag.
    const analyze = vi.fn<NonNullable<NonNullable<Parameters<typeof recheckVoiceCandidate>[1]>["analyze"]>>(async input => ({
      wav: input.wav, transcript: input.expectedText, coverage: 0, internalPausesMs: [], leadingQuietMs: 0, trailingQuietMs: 0,
      cutStartSeconds: 0, cutEndSeconds: paragraphPcmFrames(input.wav).frames / 48_000, asrModel: "faster-whisper-large-v3/cpu/int8",
      recognition: { analysisMode: "cutting_only", stage: "complete", expectedText: input.expectedText, followingText: input.followingText ?? "",
        sourceTranscript: input.expectedText, targetTranscript: input.expectedText,
        sourceWords: [{ text: input.expectedText, start: .1, end: .5 }] },
      boundaryOnly: { method: input.followingText ? "ordered_word_boundary" : "whole_recording", alignmentSimilarity: 0,
        targetEndWordIndex: 0, ...(input.followingText ? { followingStartWordIndex: 1 } : {}), contentVerified: false, internalPausePositions: [] } }));
    const ordinary = await recheckVoiceCandidate({ ...inputFor(data), candidateId: result.candidate.candidateId }, { analyze });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(ordinary.candidate.provenance.forcedSegmentation).toBeUndefined();
    expect(ordinary.candidate.provenance.longText!.groups.every(group => !group.segmentationMethod)).toBe(true);
    expect(ordinary.candidate.qualityWarnings.join("")).not.toContain("强制切分");
    const rejected = await recheckVoiceCandidate({ ...inputFor(data), candidateId: result.candidate.candidateId }, {
      analyze: async () => { throw new VoiceGroupAnalysisError("切点仍不明", 422, "no_verified_quiet_cut"); } });
    expect(rejected.candidate.provenance.forcedSegmentation).toBeUndefined();
    expect(rejected.candidate.provenance.longText!.groups.every(group => group.checkStatus === "review")).toBe(true);
    expect(rejected.candidate.provenance.longText!.groups[0].internalPauseClasses).toEqual(["short"]);
  });

  it("retains a failed final group whole without invoking or inventing CTC results", async () => {
    const data = await longFixture(true);
    const result = await forceSplitVoiceCandidate(inputFor(data), { forceAlign: data.forceAlign });
    expect(data.forceAlign).not.toHaveBeenCalled();
    expect(result.candidate.provenance.forcedSegmentation?.alignments).toMatchObject([{ groupIndex: 1, method: "whole_recording", cutFrames: [] }]);
    expect(result.candidate.provenance.longText!.groups[0]).toEqual(data.longText.groups[0]);
    const group = result.candidate.provenance.longText!.groups[1];
    expect(await readFile(resolveClipAssetPath(group.asset.assetId, data.config))).toEqual(Buffer.from(data.originals[1]));
    expect(group.recognition).toEqual(data.longText.groups[1].recognition);
  });

  it.each(["context", "duplicate_source", "missing_source"])("rejects %s before CTC without changing candidates", async kind => {
    const data = await longFixture(), before = await readFile(resolveCandidateManifestPath(data.config));
    if (kind === "context") data.clips[0].text += "改文。";
    if (kind === "duplicate_source") await cp(data.trace, path.join(data.workRoot, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"), { recursive: true });
    if (kind === "missing_source") await rm(path.join(data.trace, "group-1-take-1-source.wav"));
    await expect(forceSplitVoiceCandidate(inputFor(data), { forceAlign: data.forceAlign })).rejects.toMatchObject({ statusCode: kind === "context" ? 409 : 422 });
    expect(data.forceAlign).not.toHaveBeenCalled();
    expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
  });

  it.each(["alignment_failure", "bad_receipt", "changed_pcm", "discarded", "cancelled"])("keeps the old result on %s", async kind => {
    const data = await paragraphFixture(), controller = new AbortController();
    const before = await readFile(resolveCandidateManifestPath(data.config));
    data.forceAlign.mockImplementationOnce(async input => {
      if (kind === "alignment_failure") throw new VoiceForcedAlignmentError("字符无法对齐", 422, "ctc_alignment_failed");
      if (kind === "changed_pcm") await writeFile(resolveClipAssetPath(data.candidate.asset.assetId, data.config),
        writePcm16Wav(new Float32Array(96_000).fill(.02), 48_000));
      if (kind === "discarded") await discardAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId,
        projectId: data.candidate.projectId, clipId: data.candidate.clipId });
      if (kind === "cancelled") controller.abort();
      const result = aligned(input); if (kind === "bad_receipt") result.sourceSha256 = "0".repeat(64);
      return result;
    });
    await expect(forceSplitVoiceCandidate({ ...inputFor(data), signal: controller.signal }, { forceAlign: data.forceAlign }))
      .rejects.toMatchObject({ statusCode: kind === "cancelled" ? 499 : ["changed_pcm", "discarded"].includes(kind) ? 409 : 422 });
    if (kind !== "discarded") expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
    else expect((await listAudioCandidates({ config: data.config, projectId: data.project.project_id })).length).toBe(0);
    expect(await readdir(path.join(data.root, "locks"))).toEqual([]);
  });
});
