import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { adoptAudioCandidate } from "./candidate-acceptance";
import { resolveClipAssetPath, saveClipAsset } from "./local-asset-store";
import { confirmParagraphAudioCandidates, discardAudioCandidate, getAudioCandidate, listAudioCandidates, resolveCandidateManifestPath, saveParagraphAudioCandidates } from "./local-candidate-store";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { createInitialProjectLibrary, getCurrentLibraryEntry } from "./project-library";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { confirmVoiceParagraphText } from "./voice-paragraph-confirmation";
import { isVoiceParagraphManuallyConfirmed, VoiceParagraphResultSchema } from "./voice-paragraph-result";
import { sliceParagraphPcmWav } from "./voice-paragraph-split";
import { ShortSentenceReviewSchema, VoiceRecognitionSchema } from "./voice-recognition";

async function fixture(bothNeedConfirmation = false) {
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: await mkdtemp(path.join(os.tmpdir(), "paragraph-confirm-test-")) });
  const initial = structuredClone(demoProject), initialClips = initial.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  initialClips[0].text = "回来啦。"; initialClips[1].text = bothNeedConfirmation ? "已经好了。" : "我替你倒杯茶。";
  const project = switchSpeechWorkspace(ensureSpeechWorkspaces(initial), "paragraph");
  const clips = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips.slice(0, 2);
  project.speechWorkspace!.groups = [{ id: "confirm-group", clipIds: clips.map((clip) => clip.id) },
    ...project.timeline.tracks.find((track) => track.track_type === "voice")!.clips.slice(2).map((clip) => ({ id: `group_${clip.id}`, clipIds: [clip.id] }))];
  const context = getVoiceParagraphContext(project, clips[0].id)!;
  const wav = writePcm16Wav(new Float32Array(96_000).fill(.05), 48_000);
  const sourceAsset = await saveClipAsset({ config, clipId: "complete_source", wav, duration: 2 });
  const window = { transcript: "回来", words: [{ text: "回来", start: .1, end: .7 }], durationSeconds: 1 };
  const following = clips[1].text.replace(/[。]/g, "");
  const review = ShortSentenceReviewSchema.parse({ status: "needs_confirmation", reason: "missing_final_particle", expected: "回来啦",
    sourcePrefix: "回来了", expectedPinyin: "la5", sourcePinyin: "le5", similarity: 2 / 3, left: window,
    right: { transcript: following, words: [{ text: following, start: .1, end: .8 }], durationSeconds: 1 }, final: window });
  const recognition = VoiceRecognitionSchema.parse({ stage: "complete", expectedText: clips[0].text, followingText: clips[1].text,
    sourceTranscript: "回来了" + following, sourceWords: [{ text: "回来了", start: .1, end: .7 }, { text: following, start: 1.1, end: 1.8 }],
    targetTranscript: "回来", shortSentenceReview: review });
  const finalReview = bothNeedConfirmation ? ShortSentenceReviewSchema.parse({ status: "needs_confirmation", reason: "missing_final_particle", expected: "已经好了",
    sourcePrefix: "已经好了", expectedPinyin: "le5", sourcePinyin: "le5", similarity: .75,
    final: { transcript: "已经好", words: [{ text: "已经好", start: .1, end: .7 }], durationSeconds: 1 } }) : undefined;
  const finalRecognition = finalReview ? VoiceRecognitionSchema.parse({ stage: "complete", expectedText: clips[1].text,
    sourceTranscript: "已经好了", sourceWords: [{ text: "已经好了", start: .1, end: .7 }], targetTranscript: "已经好", shortSentenceReview: finalReview }) : undefined;
  const segments = await Promise.all(clips.map(async (clip, index) => ({ clipId: clip.id, text: clip.text,
    asset: await saveClipAsset({ config, clipId: clip.id, wav: sliceParagraphPcmWav(wav, index * 48_000, (index + 1) * 48_000), duration: 1 }),
    cutStartSeconds: index, cutEndSeconds: index + 1, ...(index === 0 ? { recognition, textReview: review } : finalReview ? { recognition: finalRecognition, textReview: finalReview } : {}) })));
  const paragraph = VoiceParagraphResultSchema.parse({ version: 1, groupId: context.groupId, text: context.text,
    clipIds: clips.map((clip) => clip.id), sourceAsset, checkStatus: "needs_confirmation", segments });
  const base = makeVoiceCandidateFixture();
  const candidates = clips.map((clip, index) => AudioCandidateSchema.parse({ ...base, candidateId: `confirmation_take_${index}`, projectId: project.project_id,
    clipId: clip.id, sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, undefined, context), asset: segments[index].asset,
    provenance: { ...base.provenance, generationMode: "paragraph", paragraph } }));
  await saveParagraphAudioCandidates({ config, candidates });
  const input = { config, project, clipId: clips[1].id, candidateId: candidates[1].candidateId, confirmedClipIds: bothNeedConfirmation ? clips.map((clip) => clip.id) : [clips[0].id], now: new Date("2026-10-14T15:00:00.000Z") };
  return { config, project, clips, context, wav, paragraph, candidates, input };
}

describe("manual paragraph text confirmation", () => {
  it.each(["source", "final", "both"])("retains %s same-tone short-sentence differences through explicit confirmation", async (kind) => {
    const data = await fixture(); data.clips[1].text = "过来坐炉子边暖和。";
    const context = getVoiceParagraphContext(data.project, data.input.clipId)!;
    const expected = "过来坐炉子边暖和", variant = "过来做炉子边暖和";
    const source = kind === "final" ? expected : variant, final = kind === "source" ? expected : variant;
    const review = ShortSentenceReviewSchema.parse({ status: "needs_confirmation", reason: "same_tone_substitution", expected,
      sourcePrefix: source, similarity: final === expected ? 1 : .875,
      differences: [{ index: 2, expected: "坐", recognized: "做", expectedPinyin: "zuo4", recognizedPinyin: "zuo4", rule: "same_tone" }],
      final: { transcript: final, words: [{ text: final, start: .1, end: .8 }], durationSeconds: 1 } });
    const recognition = VoiceRecognitionSchema.parse({ stage: "complete", expectedText: data.clips[1].text, sourceTranscript: source,
      sourceWords: [{ text: source, start: .1, end: .8 }], targetTranscript: final, shortSentenceReview: review,
      ...(final === expected ? { contentComparison: { status: "matched", similarity: 1, threshold: .9, substitutionCount: 0, expected, recognized: expected } } : {}) });
    const firstReview = ShortSentenceReviewSchema.parse({ ...data.paragraph.segments[0].textReview,
      right: { transcript: expected, words: [{ text: expected, start: .1, end: .8 }], durationSeconds: 1 } });
    const firstRecognition = VoiceRecognitionSchema.parse({ ...data.paragraph.segments[0].recognition, followingText: data.clips[1].text,
      sourceTranscript: "回来了" + expected, sourceWords: [{ text: "回来了", start: .1, end: .7 }, { text: expected, start: 1.1, end: 1.8 }], shortSentenceReview: firstReview });
    const paragraph = VoiceParagraphResultSchema.parse({ ...data.paragraph, text: context.text, segments: [
      { ...data.paragraph.segments[0], textReview: firstReview, recognition: firstRecognition },
      { ...data.paragraph.segments[1], text: data.clips[1].text, textReview: review, recognition },
    ] });
    const candidates = data.candidates.map((candidate, index) => AudioCandidateSchema.parse({ ...candidate, candidateId: `same_tone_take_${index}`,
      sourceFingerprint: getVoiceCandidateSourceFingerprint(data.clips[index], undefined, context), provenance: { ...candidate.provenance, paragraph } }));
    await saveParagraphAudioCandidates({ config: data.config, candidates });
    expect(() => adoptAudioCandidate(createInitialProjectLibrary(data.project), candidates[1])).not.toThrow();
    expect(candidates[1].provenance.paragraph!.manualTextConfirmation).toBeUndefined();
    const result = await confirmVoiceParagraphText({ ...data.input, candidateId: candidates[1].candidateId, confirmedClipIds: paragraph.clipIds });
    expect(result.candidate.provenance.paragraph?.checkStatus).toBe("needs_confirmation");
    expect(result.candidate.provenance.paragraph?.segments).toEqual(paragraph.segments);
    expect(result.candidate.provenance.paragraph?.segments[1].textReview?.similarity).toBe(final === expected ? 1 : .875);
    expect(isVoiceParagraphManuallyConfirmed(result.candidate.provenance.paragraph!)).toBe(true);
    expect(result.candidate.provenance.paragraph!.manualTextConfirmation!.confirmedClipIds).toEqual(paragraph.clipIds);
    expect(() => adoptAudioCandidate(createInitialProjectLibrary(data.project), result.candidate)).not.toThrow();
    expect(await readFile(resolveClipAssetPath(paragraph.sourceAsset.assetId, data.config))).toEqual(Buffer.from(data.wav));
  });
  it("requires every reviewed sentence in original order before confirming a multi-review take", async () => {
    const data = await fixture(true), before = await readFile(resolveCandidateManifestPath(data.config));
    for (const ids of [[data.clips[0].id], [...data.input.confirmedClipIds].reverse()]) {
      await expect(confirmVoiceParagraphText({ ...data.input, confirmedClipIds: ids })).rejects.toMatchObject({ statusCode: 400 });
      expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
    }
    const result = await confirmVoiceParagraphText(data.input);
    expect(result.candidates.every((item) => JSON.stringify(item.provenance.paragraph!.manualTextConfirmation?.confirmedClipIds) === JSON.stringify(data.input.confirmedClipIds))).toBe(true);
  });
  it("blocks adoption before listening and records all siblings atomically without changing ASR or original PCM", async () => {
    const data = await fixture(), library = createInitialProjectLibrary(data.project);
    expect(() => adoptAudioCandidate(library, data.candidates[1])).not.toThrow();
    expect(data.candidates[1].provenance.paragraph!.manualTextConfirmation).toBeUndefined();
    const shortBefore = structuredClone(data.project.speechWorkspace!.short);
    const result = await confirmVoiceParagraphText(data.input);
    expect(result.candidate.candidateId).toBe(data.input.candidateId);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidate.provenance.paragraph).toMatchObject({ checkStatus: "needs_confirmation", manualTextConfirmation: {
      sourceCandidateId: data.input.candidateId, confirmedClipIds: [data.clips[0].id], confirmedAt: data.input.now.toISOString() } });
    expect(result.candidate.provenance.paragraph!.segments).toEqual(data.paragraph.segments);
    for (const updated of result.candidates) {
      expect(isVoiceParagraphManuallyConfirmed(updated.provenance.paragraph!)).toBe(true);
      const { manualTextConfirmation: _receipt, ...rest } = updated.provenance.paragraph!; void _receipt;
      expect(rest).toEqual(data.paragraph);
      expect(await getAudioCandidate({ config: data.config, candidateId: updated.candidateId })).toEqual(updated);
    }
    const adopted = getCurrentLibraryEntry(adoptAudioCandidate(library, result.candidate)).project;
    expect(adopted.speechWorkspace!.short).toEqual(shortBefore);
    expect(adopted.timeline.tracks.find((track) => track.track_type === "voice")!.clips.slice(0, 2).map((clip) => clip.asset.asset_id))
      .toEqual(data.paragraph.segments.map((segment) => segment.asset.assetId));
    expect(await readFile(resolveClipAssetPath(data.paragraph.sourceAsset.assetId, data.config))).toEqual(Buffer.from(data.wav));
    const again = await confirmVoiceParagraphText({ ...data.input, now: new Date("2026-10-14T16:00:00.000Z") });
    expect(again).toEqual(result);
  });
  it.each([{ ids: [] }, { ids: ["unknown"] }, { ids: ["voice_001", "voice_001"] }, { ids: ["voice_002", "voice_001"] }])("rejects missing, foreign or repeated confirmation IDs $ids", async ({ ids }) => {
    const data = await fixture(), before = await readFile(resolveCandidateManifestPath(data.config));
    await expect(confirmVoiceParagraphText({ ...data.input, confirmedClipIds: ids })).rejects.toMatchObject({ statusCode: 400 });
    expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
  });
  it.each(["foreign", "short", "text", "group", "style", "silent", "discarded", "missing_sibling", "changed_sibling"]) ("rejects %s source or take changes", async (kind) => {
    const data = await fixture();
    if (kind === "foreign") data.project.project_id = "foreign";
    if (kind === "short") data.input.project = switchSpeechWorkspace(data.project, "short");
    if (kind === "text") data.clips[0].text = "已经回来了。";
    if (kind === "group") data.project.speechWorkspace!.groups[0].id = "other";
    if (kind === "style") data.clips[0].style = "normal";
    if (kind === "silent") data.clips[0].kind = "silent";
    if (kind === "discarded") await discardAudioCandidate({ config: data.config, candidateId: data.input.candidateId, projectId: data.project.project_id, clipId: data.input.clipId });
    if (kind === "missing_sibling" || kind === "changed_sibling") {
      const manifest = JSON.parse(await readFile(resolveCandidateManifestPath(data.config), "utf8"));
      if (kind === "missing_sibling") manifest.candidates.shift(); else manifest.candidates[0].sourceFingerprint = "changed";
      await writeFile(resolveCandidateManifestPath(data.config), JSON.stringify(manifest));
    }
    const before = await readFile(resolveCandidateManifestPath(data.config));
    await expect(confirmVoiceParagraphText(data.input)).rejects.toMatchObject({ statusCode: kind === "foreign" || kind === "discarded" ? 404 : kind === "short" ? 400 : 409 });
    expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
  });
  it("refuses changed short PCM even when stored metadata and text are unchanged", async () => {
    const data = await fixture(), before = await readFile(resolveCandidateManifestPath(data.config));
    await writeFile(resolveClipAssetPath(data.paragraph.segments[0].asset.assetId, data.config), writePcm16Wav(new Float32Array(48_000).fill(.06), 48_000));
    await expect(confirmVoiceParagraphText(data.input)).rejects.toMatchObject({ statusCode: 422 });
    expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
  });
  it("refuses an abandoned source snapshot under the manifest lock and never partially confirms siblings", async () => {
    const data = await fixture();
    await discardAudioCandidate({ config: data.config, candidateId: data.input.candidateId, projectId: data.project.project_id, clipId: data.input.clipId });
    const before = await readFile(resolveCandidateManifestPath(data.config));
    await expect(confirmParagraphAudioCandidates({ config: data.config, sourceCandidate: data.candidates[1], confirmedClipIds: data.input.confirmedClipIds,
      sourceCandidates: data.candidates,
      confirmedAt: data.input.now.toISOString() })).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
    expect((await listAudioCandidates({ config: data.config, projectId: data.project.project_id, includeDiscarded: true })).every((item) => !item.provenance.paragraph!.manualTextConfirmation)).toBe(true);
  });
  it("rechecks every sibling snapshot under the lock, including a changed sibling fingerprint", async () => {
    const data = await fixture();
    const manifest = JSON.parse(await readFile(resolveCandidateManifestPath(data.config), "utf8"));
    manifest.candidates[0].sourceFingerprint = "late_changed_source";
    await writeFile(resolveCandidateManifestPath(data.config), JSON.stringify(manifest));
    const before = await readFile(resolveCandidateManifestPath(data.config));
    await expect(confirmParagraphAudioCandidates({ config: data.config, sourceCandidate: data.candidates[1], sourceCandidates: data.candidates,
      confirmedClipIds: data.input.confirmedClipIds, confirmedAt: data.input.now.toISOString() })).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
  });
  it("checks cancellation before any receipt is written", async () => {
    const data = await fixture(), before = await readFile(resolveCandidateManifestPath(data.config));
    const controller = new AbortController(); controller.abort();
    await expect(confirmVoiceParagraphText({ ...data.input, signal: controller.signal })).rejects.toThrow();
    expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
  });
  it("rejects automatic pass, missing review evidence and forged incomplete manual receipts at the schema gate", async () => {
    const { paragraph } = await fixture();
    expect(VoiceParagraphResultSchema.safeParse({ ...paragraph, checkStatus: "passed" }).success).toBe(false);
    expect(VoiceParagraphResultSchema.safeParse({ ...paragraph, segments: paragraph.segments.map(({ textReview: _review, ...rest }) => { void _review; return rest; }) }).success).toBe(false);
    expect(VoiceParagraphResultSchema.safeParse({ ...paragraph, manualTextConfirmation: { sourceCandidateId: "source", confirmedAt: "2026-10-14T15:00:00.000Z", confirmedClipIds: ["wrong"] } }).success).toBe(false);
  });
});
