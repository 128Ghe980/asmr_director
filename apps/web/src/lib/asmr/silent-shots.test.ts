import { describe, expect, it, vi } from "vitest";
import { demoProject } from "./mock-project";
import { AsmrProjectSchema, type AsmrProject, type VoiceClip } from "./schema";
import { addSilentClip, addVoiceClip, deleteVoiceClip, moveVoiceClip, setSilentClipDuration, splitVoiceClip, mergeVoiceClipWithNext } from "./voice-segments";
import { getAcceptedVoicePreviewPlan } from "./accepted-voice-preview";
import { getStudioBatchTargets } from "./studio-batch-generation";
import { getStudioAudioOverview } from "./studio-audio-overview";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getMissingProjectMixClipIds } from "./project-mix-state";
import { renderProjectMixWav } from "./project-mix-renderer";
import { decodePcmWav } from "./pcm-audio";
import { generateLocalClip } from "./local-clip-generation";
import { generateClipStoryboard } from "./clip-storyboard-service";
import { asmrSoundFixture } from "./asmr-sound-test-fixture";
import { ClipVideoStoryboardSchema, createClipH3Prompt, createClipVideoSourceFingerprint,
  getPreviousClipPromptFingerprint, getPreviousVoiceClip, getUsableClipH3Prompts, isClipVideoStoryboardCurrent, type ClipVideoStoryboard } from "./video-plan";
import { captureSpeechWorkspace, ensureSpeechWorkspaces, getSpeechWorkspaceProject, mergeSpeechWorkspaceProject, switchSpeechWorkspace, syncSharedSpeechScript } from "./speech-workspace";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";
import { commitGenerationSuccess } from "./generation-project-state";

function voices(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
}
function fixture() {
  const project = structuredClone(demoProject);
  const clips = voices(project).slice(0, 3);
  for (const track of project.timeline.tracks) track.clips = [];
  for (const [index, clip] of clips.entries()) {
    Object.assign(clip, { start: index * 3, duration: 2, pause_after: 1, semantic_unit: true });
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `adopted_${index}`, uri: `asset://clip/adopted_${index}`, duration: 2 };
  }
  voices(project).push(...clips);
  project.videoPlan = { version: 1, sceneDescription: "暖光木屋，桌边有一杯热茶。", shots: {} };
  return project;
}
function silent(clip: VoiceClip) {
  clip.kind = "silent";
  clip.text = "手部特写，轻轻放下热茶。";
  clip.generation.status = "asset_pending";
  clip.asset = { asset_id: null, uri: null, duration: null };
}
function saveShot(project: AsmrProject, clip: VoiceClip, previous?: VoiceClip) {
  const shot: ClipVideoStoryboard = {
    version: 1, promptFormat: "minimax-h3", clipId: clip.id, sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
    title: "茶杯落桌", visual: "Warm light falls on the wooden table.", action: "S1 gently sets down the cup.", camera: "A static close-up of the hands.",
    ...(clip.kind === "silent" ? { kind: "silent", duration: clip.duration, ambientSound: "Faint steady room tone." }
      : { audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 2 } }),
    ...(previous ? { previousClipId: previous.id, previousPromptFingerprint: getPreviousClipPromptFingerprint(project, clip.id)! } : {}),
  };
  project.videoPlan!.shots[clip.id] = shot;
  return shot;
}

describe("silent editorial shots", () => {
  it("merges a completed silent storyboard only into its originating bank while preview and exports follow the active page", () => {
    const original = fixture(), clip = voices(original)[1]; silent(clip);
    const short = ensureSpeechWorkspaces(original);
    const requestProjection = getSpeechWorkspaceProject(short, "short");
    const shortShot = saveShot(requestProjection, voices(requestProjection)[1]);
    shortShot.visual = "A close-up of the tea cup in the short workspace.";
    let activeParagraph = switchSpeechWorkspace(short, "paragraph");
    const paragraphShot = saveShot(activeParagraph, voices(activeParagraph)[1]);
    paragraphShot.visual = "A quiet window view in the paragraph workspace.";
    activeParagraph = captureSpeechWorkspace(activeParagraph);
    const before = structuredClone(activeParagraph);
    const merged = mergeSpeechWorkspaceProject(activeParagraph, "short", requestProjection);
    expect(merged.speechWorkspace!.activeMode).toBe("paragraph");
    expect(merged.videoPlan).toEqual(before.videoPlan);
    expect(merged.speechWorkspace!.paragraph).toEqual(before.speechWorkspace!.paragraph);
    expect(createClipH3Prompt(merged, clip.id)).toContain(paragraphShot.visual);
    expect(createClipH3Prompt(getSpeechWorkspaceProject(merged, "short"), clip.id)).toContain(shortShot.visual);
    expect(getUsableClipH3Prompts(merged).get(clip.id)).not.toContain(shortShot.visual);
    expect(getAcceptedVoicePreviewPlan(merged)).toMatchObject({ clipCount: 0, silentCount: 1 });
    expect(getAcceptedVoicePreviewPlan(switchSpeechWorkspace(merged, "short"))).toMatchObject({ clipCount: 2, silentCount: 1 });
    expect(activeParagraph).toEqual(before);
  });
  it("keeps audio overview and batch targets scoped to the active bank and exposes retained stale takes", () => {
    let project = fixture();
    for (const clip of voices(project)) {
      clip.emotion = "calm"; clip.style = "soft"; clip.pace = "slow";
      clip.generation.status = "asset_pending"; clip.asset = { asset_id: null, uri: null, duration: null };
    }
    project = ensureSpeechWorkspaces(project);
    const clip = voices(project)[0];
    const shortTake = makeVoiceCandidateFixture({ projectId: project.project_id, clipId: clip.id,
      sourceFingerprint: getVoiceCandidateSourceFingerprint(clip) });
    const paragraphPage = switchSpeechWorkspace(project, "paragraph");
    const context = getVoiceParagraphContext(paragraphPage, clip.id)!;
    const segments = voices(paragraphPage).map((member, index) => ({ clipId: member.id, text: member.text,
      asset: { assetId: `part_${index}`, uri: `asset://clip/part_${index}`, duration: 1 }, cutStartSeconds: index, cutEndSeconds: index + 1 }));
    const paragraphTake: AudioCandidate = AudioCandidateSchema.parse({ ...shortTake, candidateId: "paragraph_take",
      sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, undefined, context), asset: segments[0].asset,
      provenance: { ...shortTake.provenance, generationMode: "paragraph", paragraph: {
        version: 1, groupId: context.groupId, text: context.text, clipIds: context.clips.map(member => member.clipId),
        sourceAsset: { assetId: "raw_paragraph", uri: "asset://clip/raw_paragraph", duration: 3 }, checkStatus: "passed", segments,
      } },
    });
    expect(getStudioAudioOverview(project, [shortTake, paragraphTake]).unadopted).toBe(1);
    expect(getStudioAudioOverview(project, [paragraphTake]).unadopted).toBe(0);
    expect(getStudioAudioOverview(paragraphPage, [shortTake]).unadopted).toBe(0);
    expect(getStudioAudioOverview(paragraphPage, [shortTake, paragraphTake]).unadopted).toBe(1);
    expect(getStudioBatchTargets(project, "audio_all")).toHaveLength(3);
    expect(getStudioBatchTargets(paragraphPage, "audio_all")).toEqual([clip.id]);
    const stale = fixture(); voices(stale)[0].audio_stale = true;
    expect(getStudioAudioOverview(stale, [])).toEqual({ adopted: 2, pending: 0, unadopted: 0, needsUpdate: 1, total: 3 });
    expect(getStudioBatchTargets(stale, "audio_missing")).toEqual([voices(stale)[0].id]);
    expect(getAcceptedVoicePreviewPlan(stale)).toMatchObject({ clipCount: 3, staleCount: 1 });
    expect(getAcceptedVoicePreviewPlan(stale).entries[0]).toHaveProperty("assetId", "adopted_0");
    expect(() => createClipVideoSourceFingerprint(stale, voices(stale)[0].id)).toThrow();
    const refreshed = commitGenerationSuccess(stale, voices(stale)[0].id,
      { assetId: "new_take", uri: "asset://clip/new_take", duration: 2 });
    expect(voices(refreshed)[0].audio_stale).toBe(false);
    expect(getStudioAudioOverview(refreshed, [])).toEqual({ adopted: 3, pending: 0, unadopted: 0, total: 3 });
  });
  it.each([undefined, "   "])("inserts a pending-context description without inventing story props (%s)", description => {
    const project = fixture(), before = structuredClone(project), clips = voices(project);
    clips[0].text = "寒潮就要来了，先进门躲躲风。";
    clips[1].text = "把门关上，别让冷风灌进来。";
    const input = structuredClone(project);
    const result = addSilentClip(project, clips[0].id, { description });
    const inserted = voices(result.project).find(clip => clip.id === result.selectedClipId)!;
    expect(inserted).toMatchObject({ kind: "silent", text: "待设计：根据前后剧情安排自然衔接的无对白画面。", duration: 4,
      asset: { asset_id: null, uri: null, duration: null } });
    expect(inserted.text).not.toMatch(/水杯|桌边/);
    expect(project).toEqual(input);
    expect(voices(result.project).filter(clip => clip.kind !== "silent").map(clip => clip.asset)).toEqual(voices(before).map(clip => clip.asset));
    expect(AsmrProjectSchema.safeParse(result.project).success).toBe(true);
  });

  it("shares silent insertion, movement and duration edits without clearing or staling adopted speech in either bank", () => {
    let project = ensureSpeechWorkspaces(fixture());
    project = switchSpeechWorkspace(project, "paragraph");
    for (const [index, clip] of voices(project).entries()) {
      clip.generation.status = "asset_generated";
      clip.asset = { asset_id: `paragraph_${index}`, uri: `asset://clip/paragraph_${index}`, duration: 2 };
    }
    project = switchSpeechWorkspace(captureSpeechWorkspace(project), "short");
    const before = structuredClone(project);
    const inserted = addSilentClip(project, voices(project)[0].id, { duration: 5 });
    project = syncSharedSpeechScript(project, inserted.project);
    const clipId = inserted.selectedClipId!;
    project = syncSharedSpeechScript(project, moveVoiceClip(project, clipId, "down").project);
    project = syncSharedSpeechScript(project, setSilentClipDuration(project, clipId, 7));
    for (const mode of ["short", "paragraph"] as const) {
      const bank = project.speechWorkspace![mode];
      expect(bank.clips.find(clip => clip.id === clipId)).toMatchObject({ kind: "silent", duration: 7 });
      expect(bank.clips.filter(clip => clip.kind !== "silent").map(clip => clip.asset)).toEqual(before.speechWorkspace![mode].clips.map(clip => clip.asset));
      expect(bank.clips.some(clip => clip.audio_stale)).toBe(false);
    }
    const deleted = syncSharedSpeechScript(project, deleteVoiceClip(project, clipId).project);
    expect(deleted.speechWorkspace!.short.clips.some(clip => clip.id === clipId)).toBe(false);
    expect(deleted.speechWorkspace!.paragraph.clips.some(clip => clip.id === clipId)).toBe(false);
  });
  it("inserts and resizes a silent beat without changing existing audio, and keeps old project imports valid", () => {
    expect(AsmrProjectSchema.parse(demoProject).timeline.tracks[0].clips).toEqual(demoProject.timeline.tracks[0].clips);
    const project = fixture(), original = voices(project), before = structuredClone(project);
    const edit = addSilentClip(project, original[0].id, { description: "杯子落桌。", duration: 5 });
    const inserted = voices(edit.project).find(clip => clip.id === edit.selectedClipId)!;
    expect(inserted).toMatchObject({ kind: "silent", text: "杯子落桌。", start: 2, duration: 5, pause_after: 1, asset: { asset_id: null, uri: null, duration: null } });
    expect(voices(edit.project).find(clip => clip.id === original[1].id)!.start).toBe(8);
    const resized = setSilentClipDuration(edit.project, inserted.id, 7);
    expect(voices(resized).find(clip => clip.id === original[1].id)!.start).toBe(10);
    expect(AsmrProjectSchema.safeParse(resized).success).toBe(true);
    for (const clip of original) expect(voices(resized).find(item => item.id === clip.id)!.asset).toBe(clip.asset);
    expect(project).toEqual(before);
    expect(splitVoiceClip(resized, inserted.id, 2).project).toBe(resized);
    expect(mergeVoiceClipWithNext(resized, inserted.id).project).toBe(resized);
    expect(voices(addVoiceClip(resized, inserted.id).project).find(clip => clip.text === "在这里输入台词。")!.kind).toBe("speech");
  });

  it("skips silent descriptions in all speech jobs, audio counts and context, but includes storyboard work", () => {
    const project = fixture(), clips = voices(project); silent(clips[1]);
    expect(getStudioBatchTargets(project, "audio_all")).toEqual([clips[0].id, clips[2].id]);
    expect(getStudioBatchTargets(project, "audio_missing")).toEqual([]);
    expect(getStudioBatchTargets(project, "storyboard_missing")).toEqual(clips.map(clip => clip.id));
    expect(getStudioAudioOverview(project, [])).toEqual({ adopted: 2, pending: 0, unadopted: 0, total: 2 });
    expect(getVoiceGenerationContext(project, clips[0].id)).toEqual({ version: 1, followingClauses: [], isFinal: true });
    expect(getVoiceGenerationContext(project, clips[1].id)).toBeUndefined();
    expect(getMissingProjectMixClipIds(project)).toEqual([]);
    const plan = getAcceptedVoicePreviewPlan(project);
    expect(plan).toMatchObject({ clipCount: 2, skippedCount: 0, totalVoiceCount: 2, silentCount: 1 });
    expect(plan.entries[1]).toEqual({ clipId: clips[1].id, silenceDurationSeconds: 2, gapAfterSeconds: 1 });
  });

  it("rejects direct speech generation before loading a model or requesting an endpoint", async () => {
    const project = fixture(), clip = voices(project)[1]; silent(clip);
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(generateLocalClip({ project, clipId: clip.id, fetchImpl,
      config: { runtimeRoot: "unused", clipAssetRoot: "unused", mixAssetRoot: "unused", gptSovitsBaseUrl: "unused", voicePackPath: "unused" },
    })).rejects.toThrow("无对白镜头不生成语音");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("generates a silent storyboard using description and declared duration without reading speech assets", async () => {
    const project = fixture(), clip = voices(project)[1]; silent(clip); clip.duration = 4;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      title: "茶杯落桌", visual: "Warm light falls on the table.", action: "S1 sets down a cup.", camera: "Static close-up.", ambientSound: "Faint steady room tone.", asmrSound: asmrSoundFixture,
    }) } }] }));
    const result = await generateClipStoryboard({ provider: "ollama", project, clipId: clip.id, referenceMode: "new", includePrevious: false, instruction: "" }, {
      env: { ASMR_PLANNER_API_URL: "https://api.example.test/v1", ASMR_PLANNER_API_KEY: "test-only", ASMR_PLANNER_API_MODEL: "test-model" }, fetchImpl,
      config: { runtimeRoot: "does-not-exist", clipAssetRoot: "does-not-exist", mixAssetRoot: "does-not-exist", gptSovitsBaseUrl: "unused", voicePackPath: "unused" },
    });
    expect(result.storyboard).toMatchObject({ kind: "silent", duration: 4, ambientSound: "Faint steady room tone." });
    expect(result.storyboard.audio).toBeUndefined();
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages[1].content).toContain('"description":"手部特写，轻轻放下热茶。"');
    expect(body.messages[1].content).toContain('"durationSeconds":4');
    project.videoPlan!.shots[clip.id] = result.storyboard;
    const prompt = createClipH3Prompt(project, clip.id);
    expect(prompt).toContain("4 seconds"); expect(prompt).toContain("Faint steady room tone.");
    expect(prompt).not.toContain("<Audio 1>"); expect(prompt).not.toContain("<d>");
    expect(prompt).not.toContain(clip.text);
  });

  it("allows silent shots on either side of continuity chains and expires the chain on description or duration edits", () => {
    const project = fixture(), clips = voices(project); silent(clips[1]);
    saveShot(project, clips[0]); saveShot(project, clips[1], clips[0]); saveShot(project, clips[2], clips[1]);
    expect(getPreviousVoiceClip(project, clips[2].id)!.id).toBe(clips[1].id);
    expect(isClipVideoStoryboardCurrent(project, clips[2].id)).toBe(true);
    const changed = structuredClone(project); voices(changed)[1].duration += 1;
    expect(isClipVideoStoryboardCurrent(changed, clips[1].id)).toBe(false);
    expect(isClipVideoStoryboardCurrent(changed, clips[2].id)).toBe(false);
    clips[1].text += "随后停留。";
    expect(isClipVideoStoryboardCurrent(project, clips[1].id)).toBe(false);
    expect(ClipVideoStoryboardSchema.safeParse({ ...project.videoPlan!.shots[clips[1].id], audio: { assetId: "fake", uri: "asset://clip/fake", duration: 2 } }).success).toBe(false);
  });

  it("renders silent timeline slots without trying to load an asset", async () => {
    const project = fixture(), clip = voices(project)[1]; silent(clip);
    for (const track of project.timeline.tracks) track.clips = track.track_type === "voice" ? [clip] : [];
    project.duration = 10;
    const loadClipAsset = vi.fn();
    const pcm = decodePcmWav(await renderProjectMixWav({ project, loadClipAsset, sampleRate: 8000 }));
    expect(loadClipAsset).not.toHaveBeenCalled();
    expect(pcm.samples.length).toBe(10 * 8000 * 2);
    expect(pcm.samples.every(sample => sample === 0)).toBe(true);
  });
});
