import { describe, expect, it } from "vitest";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { adoptAudioCandidate } from "./candidate-acceptance";
import { demoProject } from "./mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry } from "./project-library";
import type { AsmrProject, VoiceClip } from "./schema";
import { getStudioAudioOverview, getStudioAudioProgress } from "./studio-audio-overview";
import { makeSemanticVoiceLongTextResultFixture, makeVoiceCandidateFixture, makeVoiceLongTextResultFixture } from "./voice-candidate-fixture";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { ShortSentenceReviewSchema, VoiceRecognitionSchema } from "./voice-recognition";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";

function makeProject(ids = ["a", "b", "c"]): AsmrProject {
  const project = structuredClone(demoProject);
  const track = project.timeline.tracks.find((item) => item.track_type === "voice")!;
  const source = track.clips[0];
  track.clips = ids.map((id, index) => ({ ...structuredClone(source), id, start: index * 10, text: `第${index + 1}段台词。` }));
  return project;
}

function voices(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.find((item) => item.track_type === "voice")!.clips;
}

function candidate(project: AsmrProject, index = 0, id = `take_${index}`): AudioCandidate {
  const clip = voices(project)[index];
  return makeVoiceCandidateFixture({
    candidateId: id, projectId: project.project_id, clipId: clip.id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clip),
    asset: { assetId: id, uri: `asset://clip/${id}`, duration: 3 },
  });
}

function longCandidate(project: AsmrProject, index = 0): AudioCandidate {
  const clip = voices(project)[index];
  const context = getVoiceGenerationContext(project, clip.id);
  const take = candidate(project, index);
  return {
    ...take, sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, context),
    provenance: {
      ...take.provenance, generationMode: "long_text",
      longText: context ? makeSemanticVoiceLongTextResultFixture(clip.text, context) : makeVoiceLongTextResultFixture(),
    },
  };
}

function adopt(clip: VoiceClip): void {
  clip.generation.status = "asset_generated";
  clip.asset = { asset_id: `adopted_${clip.id}`, uri: `asset://clip/adopted_${clip.id}`, duration: 3 };
}

describe("studio audio overview", () => {
  it("counts safe legacy text-review slices as usable without an extra confirmation and while their source stays current", () => {
    const initial = makeProject(["a"]);
    voices(initial)[0].text = "回来啦。";
    const project = switchSpeechWorkspace(ensureSpeechWorkspaces(initial), "paragraph");
    const context = getVoiceParagraphContext(project, "a")!;
    const textReview = ShortSentenceReviewSchema.parse({ status: "needs_confirmation", reason: "missing_final_particle",
      expected: "回来啦", sourcePrefix: "回来了", expectedPinyin: "la5", sourcePinyin: "le5", similarity: .666667,
      final: { transcript: "回来", words: [{ text: "回来", start: .2, end: .6 }], durationSeconds: 1 } });
    const recognition = VoiceRecognitionSchema.parse({ stage: "complete", expectedText: "回来啦。", sourceTranscript: "回来了",
      sourceWords: [{ text: "回来了", start: .2, end: .6 }], targetTranscript: "回来", shortSentenceReview: textReview });
    const base = candidate(project);
    const asset = { assetId: "review_slice", uri: "asset://clip/review_slice", duration: 1 };
    const take = AudioCandidateSchema.parse({ ...base, asset,
      sourceFingerprint: getVoiceCandidateSourceFingerprint(voices(project)[0], undefined, context),
      provenance: { ...base.provenance, generationMode: "paragraph", paragraph: { version: 1, groupId: context.groupId,
        text: "回来啦。", clipIds: ["a"], sourceAsset: { assetId: "review_source", uri: "asset://clip/review_source", duration: 1 },
        checkStatus: "needs_confirmation", segments: [{ clipId: "a", text: "回来啦。", asset,
          cutStartSeconds: 0, cutEndSeconds: 1, recognition, textReview }] } } });
    expect(getStudioAudioOverview(project, [take])).toEqual({ adopted: 0, pending: 0, unadopted: 1, total: 1 });
    const adopted = getCurrentLibraryEntry(adoptAudioCandidate(createInitialProjectLibrary(project), take)).project;
    expect(voices(adopted)[0].asset.asset_id).toBe(asset.assetId);
    expect(take.provenance.paragraph!.manualTextConfirmation).toBeUndefined();
    take.provenance.paragraph!.manualTextConfirmation = { sourceCandidateId: take.candidateId,
      confirmedClipIds: ["a"], confirmedAt: "2026-10-14T13:00:00.000Z" };
    expect(getStudioAudioOverview(project, [take])).toEqual({ adopted: 0, pending: 0, unadopted: 1, total: 1 });
    voices(project)[0].text = "我回来啦。";
    expect(getStudioAudioOverview(project, [take])).toEqual({ adopted: 0, pending: 1, unadopted: 0, total: 1 });
  });

  it("counts mutually exclusive paragraphs, giving adopted audio priority over multiple ready takes", () => {
    const project = makeProject();
    adopt(voices(project)[0]);
    const takes = [candidate(project), candidate(project, 0, "another_adopted_take"), candidate(project, 1), candidate(project, 1, "another_ready_take")];
    const before = structuredClone({ project, takes });

    const result = getStudioAudioOverview(project, takes);
    expect(result).toEqual({ adopted: 1, pending: 1, unadopted: 1, total: 3 });
    expect(result.adopted + result.pending + result.unadopted).toBe(result.total);
    const progress = getStudioAudioProgress(project, takes);
    expect(progress.overview).toEqual(result);
    expect(progress.byClip).toEqual({ a: "adopted", b: "unadopted", c: "pending" });
    expect(Object.keys(progress.byClip)).toHaveLength(result.total);
    for (const state of ["adopted", "pending", "unadopted"] as const) {
      expect(Object.values(progress.byClip).filter((value) => value === state)).toHaveLength(result[state]);
    }
    expect({ project, takes }).toEqual(before);
  });

  it("ignores blank dialogue, nonvoice clips, discarded, foreign, missing-clip and malformed candidates", () => {
    const project = makeProject();
    const takes = [
      { ...candidate(project), status: "discarded" as const },
      { ...candidate(project), projectId: "another_project" },
      { ...candidate(project), clipId: "removed_voice" },
      { ...candidate(project), clipId: "breath_001" },
      { ...candidate(project), asset: { assetId: "bad_take", uri: "asset://clip/different_take", duration: 3 } },
      candidate(project, 2),
    ];
    voices(project)[2].text = " \n\t ";
    adopt(voices(project)[2]);
    expect(getStudioAudioOverview(project, takes)).toEqual({ adopted: 0, pending: 2, unadopted: 0, total: 2 });
    expect(getStudioAudioProgress(project, takes).byClip).toEqual({ a: "pending", b: "pending" });
  });

  it.each(["text", "emotion", "style", "pace"] as const)("treats a candidate with changed %s as pending", (field) => {
    const project = makeProject(["a"]);
    const take = candidate(project);
    expect(getStudioAudioOverview(project, [take]).unadopted).toBe(1);
    voices(project)[0][field] += "已修改";
    expect(getStudioAudioOverview(project, [take])).toEqual({ adopted: 0, pending: 1, unadopted: 0, total: 1 });
  });

  it("checks the current forward context for semantic long-text takes while a direct take stays usable", () => {
    const project = makeProject();
    voices(project)[0].semantic_unit = true;
    const windowTake = longCandidate(project);
    const directTake = candidate(project, 0, "direct_take");
    expect(AudioCandidateSchema.safeParse(windowTake).success).toBe(true);
    expect(getStudioAudioOverview(project, [windowTake]).unadopted).toBe(1);
    expect(getStudioAudioProgress(project, [windowTake]).byClip.a).toBe("unadopted");

    voices(project)[1].text = "修改窗口内的后续台词。";
    expect(getStudioAudioOverview(project, [windowTake])).toEqual({ adopted: 0, pending: 3, unadopted: 0, total: 3 });
    expect(getStudioAudioProgress(project, [windowTake]).byClip.a).toBe("pending");
    expect(getStudioAudioOverview(project, [windowTake, directTake])).toEqual({ adopted: 0, pending: 2, unadopted: 1, total: 3 });
    expect(getStudioAudioProgress(project, [windowTake, directTake]).byClip.a).toBe("unadopted");
  });

  it("keeps bounded-context takes current after out-of-window and audio-arrangement-only changes", () => {
    const project = makeProject(Array.from({ length: 18 }, (_, index) => `voice_${index}`));
    voices(project)[0].semantic_unit = true;
    const take = longCandidate(project);
    voices(project)[17].text = "窗口以外的新台词。";
    voices(project)[0].duration += 1;
    voices(project)[0].volume_db += 1;
    voices(project)[0].position.pan = 0.4;
    voices(project)[0].generation.seed += 100;
    project.videoPlan = { version: 1, sceneDescription: "雪地木屋内", shots: {} };

    expect(getStudioAudioOverview(project, [take])).toEqual({ adopted: 0, pending: 17, unadopted: 1, total: 18 });
    expect(() => adoptAudioCandidate(createInitialProjectLibrary(project), take)).not.toThrow();
  });

  it("matches adoption eligibility even when the candidate uses a different voice recipe and request fingerprint", () => {
    const project = makeProject(["a"]);
    const take = candidate(project);
    take.requestFingerprint = "a_previous_voice_recipe";
    take.provenance.voicePackId = "normal_zh";
    take.provenance.referenceMode = "reference_only";
    take.provenance.seed = 999;
    voices(project)[0].generation.seed = 1000;
    voices(project)[0].generation.temperature = 0.5;
    expect(getStudioAudioOverview(project, [take])).toEqual({ adopted: 0, pending: 0, unadopted: 1, total: 1 });

    const adopted = getCurrentLibraryEntry(adoptAudioCandidate(createInitialProjectLibrary(project), take)).project;
    expect(getStudioAudioOverview(adopted, [take])).toEqual({ adopted: 1, pending: 0, unadopted: 0, total: 1 });
  });

  it("counts a ready full-original long-text take awaiting ASR review as generated", () => {
    const project = makeProject(["a"]);
    const take = longCandidate(project);
    take.qualityWarnings = ["文字相似度为88.9%，保留完整原音，请试听确认。"];
    for (const group of take.provenance.longText!.groups) {
      group.checkStatus = "review";
      group.coverage = 0.889;
      group.internalPausesMs = [];
      group.diagnosticCode = "target_alignment_uncertain";
    }
    expect(AudioCandidateSchema.safeParse(take).success).toBe(true);
    expect(getStudioAudioOverview(project, [take])).toEqual({ adopted: 0, pending: 0, unadopted: 1, total: 1 });
  });

  it("requires both the adopted status and asset references, with a usable candidate as the fallback", () => {
    const project = makeProject(["a", "b", "c", "d"]);
    const clips = voices(project);
    clips[0].generation.status = "asset_generated";
    clips[1].asset = { asset_id: "uncommitted_asset", uri: "asset://clip/uncommitted_asset", duration: 3 };
    adopt(clips[2]);
    clips[2].asset.uri = "  ";
    adopt(clips[3]);
    clips[3].generation.model = "GPT-SoVITS";
    expect(getStudioAudioOverview(project, [candidate(project, 2)])).toEqual({ adopted: 1, pending: 2, unadopted: 1, total: 4 });
  });

  it("returns zero counts when the project has no nonblank voice paragraphs", () => {
    const project = makeProject([]);
    expect(getStudioAudioOverview(project, [])).toEqual({ adopted: 0, pending: 0, unadopted: 0, total: 0 });
    expect(getStudioAudioProgress(project, []).byClip).toEqual({});
  });
});
