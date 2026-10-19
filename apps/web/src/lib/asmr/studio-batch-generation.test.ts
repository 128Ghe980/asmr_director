import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AudioCandidateSchema, type AudioCandidate, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { adoptAudioCandidate } from "./candidate-acceptance";
import type { GenerateClipRequest, GenerationBridge, GenerationJobSnapshot, GenerationJobUpdate } from "./generation-bridge";
import { createMockGenerationBridge } from "./mock-generation-bridge";
import { LocalStorageError } from "./local-storage-error";
import { demoProject } from "./mock-project";
import { createInitialProjectLibrary, getCurrentLibraryEntry } from "./project-library";
import type { AsmrProject, VoiceClip } from "./schema";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";
import { getStudioBatchTargets, runStudioBatchQueue, waitForStudioVoiceGeneration, type StudioBatchProgress } from "./studio-batch-generation";
import { createClipVideoSourceFingerprint, isClipVideoStoryboardCurrent } from "./video-plan";
import { makeSemanticVoiceLongTextResultFixture } from "./voice-candidate-fixture";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getVoiceParagraphContext } from "./voice-paragraph-context";

function makeProject(ids = ["a", "b", "c", "d"]): AsmrProject {
  const project = structuredClone(demoProject);
  const track = project.timeline.tracks.find((item) => item.track_type === "voice")!;
  const source = track.clips[0];
  track.clips = ids.map((id, index) => ({ ...structuredClone(source), id, start: index * 10 }));
  return project;
}
function voices(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.find((item) => item.track_type === "voice")!.clips;
}
function adopt(clip: VoiceClip) {
  clip.generation.status = "asset_generated";
  clip.asset = { asset_id: `adopted_${clip.id}`, uri: `asset://clip/adopted_${clip.id}`, duration: 3 };
}
function putShot(project: AsmrProject, clip: VoiceClip) {
  project.videoPlan ??= { version: 1, sceneDescription: project.scene.name, shots: {} };
  project.videoPlan.shots[clip.id] = {
    version: 1, promptFormat: "minimax-h3", clipId: clip.id,
    sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
    audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 3 },
    title: "窗边", visual: "S1 sits by the window.", action: "S1 lowers one hand.", camera: "Static close-up.",
  };
}
function makeCandidate(project: AsmrProject, index = 0, id = "ready_take"): AudioCandidate {
  const clip = voices(project)[index];
  return {
    version: 1, candidateId: id, projectId: project.project_id, clipId: clip.id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clip), requestFingerprint: "request",
    asset: { assetId: id, uri: `asset://clip/${id}`, duration: 3 },
    wav: { sampleRate: 48000, channels: 1, bitsPerSample: 16 },
    provenance: { provider: "voxcpm2", model: "VoxCPM2", seed: 42, temperature: 1, voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip", parameters: {} },
    qualityWarnings: [], createdAt: "2026-10-02T00:00:00.000Z", status: "ready",
  };
}
function makeParagraphCandidate(project: AsmrProject, index = 0): AudioCandidate {
  const clip = voices(project)[index];
  const paragraph = getVoiceParagraphContext(project, clip.id)!;
  const base = makeCandidate(project, index, `${clip.id}_paragraph_take`);
  const segments = paragraph.clips.map((member, memberIndex) => ({
    clipId: member.clipId, text: member.text,
    asset: { assetId: `${member.clipId}_paragraph_take`, uri: `asset://clip/${member.clipId}_paragraph_take`, duration: 3 },
    cutStartSeconds: memberIndex * 3, cutEndSeconds: (memberIndex + 1) * 3,
  }));
  return AudioCandidateSchema.parse({ ...base,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, undefined, paragraph),
    provenance: { ...base.provenance, generationMode: "paragraph", paragraph: {
      version: 1, groupId: paragraph.groupId, text: paragraph.text, clipIds: paragraph.clips.map((member) => member.clipId),
      sourceAsset: { assetId: "paragraph_source", uri: "asset://clip/paragraph_source", duration: segments.length * 3 },
      checkStatus: "passed", segments,
    } },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }

describe("studio batch targets", () => {
  it("distinguishes four actions and preserves stale and incomplete existing shots", () => {
    const project = makeProject();
    const [fresh, stale, pending, missing] = voices(project);
    [fresh, stale, missing].forEach(adopt);
    putShot(project, fresh);
    putShot(project, stale);
    stale.text += "现在的台词变了。";
    project.videoPlan!.shots[fresh.id].visual = "";
    expect(isClipVideoStoryboardCurrent(project, stale.id)).toBe(false);
    pending.asset = { asset_id: "unadopted_take", uri: "asset://clip/unadopted_take", duration: 3 };
    expect(getStudioBatchTargets(project, "audio_missing")).toEqual(["c"]);
    expect(getStudioBatchTargets(project, "audio_all")).toEqual(["a", "b", "c", "d"]);
    expect(getStudioBatchTargets(project, "storyboard_missing")).toEqual(["d"]);
    expect(getStudioBatchTargets(project, "storyboard_all")).toEqual(["a", "b", "d"]);
  });
  it("only treats a ready candidate as adopted after the existing adoption flow commits it", () => {
    const project = makeProject(["a"]);
    const candidate = makeCandidate(project);
    const library = createInitialProjectLibrary(project);
    expect(candidate.status).toBe("ready");
    expect(getStudioBatchTargets(getCurrentLibraryEntry(library).project, "audio_missing")).toEqual(["a"]);
    expect(getStudioBatchTargets(getCurrentLibraryEntry(library).project, "storyboard_all")).toEqual([]);
    const adopted = getCurrentLibraryEntry(adoptAudioCandidate(library, candidate)).project;
    expect(getStudioBatchTargets(adopted, "audio_missing")).toEqual([]);
    expect(getStudioBatchTargets(adopted, "storyboard_all")).toEqual(["a"]);
    expect(project).toEqual(getCurrentLibraryEntry(library).project);
  });
  it("filters blank dialogue and nonvoices and maintains stable timeline order without mutation", () => {
    const project = makeProject(["later", "tie_first", "tie_second", "blank"]);
    const clips = voices(project);
    clips[0].start = 50;
    clips[1].start = clips[2].start = 2;
    clips[3].text = " \n\t ";
    for (const track of project.timeline.tracks) for (const clip of track.clips) {
      clip.generation.status = "asset_generated";
      clip.asset = { asset_id: clip.id, uri: `asset://clip/${clip.id}`, duration: 3 };
    }
    const before = structuredClone(project);
    expect(getStudioBatchTargets(project, "audio_all")).toEqual(["tie_first", "tie_second", "later"]);
    expect(getStudioBatchTargets(project, "storyboard_all")).toEqual(["tie_first", "tie_second", "later"]);
    expect(getStudioBatchTargets(project, "audio_missing")).toEqual([]);
    expect(project).toEqual(before);
  });
  it("requires local adopted mapping for storyboards and includes absent asset references for audio", () => {
    const project = makeProject(["remote", "mismatch", "unsafe", "no_id", "no_uri", "valid"]);
    const [remote, mismatch, unsafe, noId, noUri, valid] = voices(project);
    voices(project).forEach(adopt);
    remote.asset.uri = "https://example.test/existing.wav";
    mismatch.asset.uri = "asset://clip/another_asset";
    unsafe.asset = { asset_id: "../escape", uri: "asset://clip/../escape", duration: 3 };
    noId.asset.asset_id = " ";
    noUri.asset.uri = null;
    expect(getStudioBatchTargets(project, "audio_missing")).toEqual([noId.id, noUri.id]);
    expect(getStudioBatchTargets(project, "storyboard_all")).toEqual([valid.id]);
    expect(getStudioBatchTargets(project, "storyboard_missing")).toEqual([valid.id]);
  });
});

describe("studio batch ungenerated audio targets", () => {
  it("fails closed while candidates are unknown and distinguishes a known empty library", () => {
    const project = makeProject(["a", "b"]);
    expect(getStudioBatchTargets(project, "audio_ungenerated")).toEqual([]);
    expect(getStudioBatchTargets(project, "audio_ungenerated", [])).toEqual(["a", "b"]);
    const candidate = makeCandidate(project);
    expect(getStudioBatchTargets(project, "audio_missing", [candidate])).toEqual(["a", "b"]);
    expect(getStudioBatchTargets(project, "audio_all", [candidate])).toEqual(["a", "b"]);
  });

  it("skips current adopted audio and usable candidates but includes stale adopted audio in timeline order", () => {
    const project = makeProject(["adopted", "ready", "stale", "missing", "silent", "blank"]);
    const clips = voices(project);
    adopt(clips[0]); adopt(clips[2]); clips[2].audio_stale = true;
    clips[2].start = 50; clips[3].start = 2;
    clips[4].kind = "silent"; clips[5].text = " \n\t ";
    const candidates = [makeCandidate(project, 1)];
    candidates[0].requestFingerprint = "previous_voice_recipe";
    candidates[0].provenance.seed = 999;
    candidates[0].provenance.voicePackId = "normal_zh";
    const before = structuredClone({ project, candidates });
    expect(getStudioBatchTargets(project, "audio_ungenerated", candidates)).toEqual(["missing", "stale"]);
    expect({ project, candidates }).toEqual(before);
  });

  it("does not let discarded, outdated, foreign or other-workspace candidates hide missing audio", () => {
    const project = makeProject(["discarded", "outdated", "foreign", "paragraph", "ready"]);
    const discarded = { ...makeCandidate(project, 0, "discarded_take"), status: "discarded" as const };
    const outdated = makeCandidate(project, 1, "outdated_take");
    voices(project)[1].text += "修改后的台词。";
    const foreign = { ...makeCandidate(project, 2, "foreign_take"), projectId: "other_project" };
    const paragraphProject = switchSpeechWorkspace(ensureSpeechWorkspaces(project), "paragraph");
    const paragraph = makeParagraphCandidate(paragraphProject, 3);
    const ready = makeCandidate(project, 4, "ready_take");
    expect(getStudioBatchTargets(project, "audio_ungenerated", [discarded, outdated, foreign, paragraph, ready]))
      .toEqual(["discarded", "outdated", "foreign", "paragraph"]);
  });

  it("rechecks a long-text candidate's forward context while a direct take remains usable", () => {
    const project = makeProject(["a", "b"]);
    const [clip, following] = voices(project);
    clip.semantic_unit = true; clip.text = "回来啦。"; following.text = "炉子边暖和。";
    const context = getVoiceGenerationContext(project, clip.id)!;
    const base = makeCandidate(project);
    const longTake = AudioCandidateSchema.parse({ ...base,
      sourceFingerprint: getVoiceCandidateSourceFingerprint(clip, context),
      provenance: { ...base.provenance, generationMode: "long_text", longText: makeSemanticVoiceLongTextResultFixture(clip.text, context) },
    });
    expect(getStudioBatchTargets(project, "audio_ungenerated", [longTake])).toEqual(["b"]);
    following.text = "后面的台词改了。";
    expect(getStudioBatchTargets(project, "audio_ungenerated", [longTake])).toEqual(["a", "b"]);
    expect(getStudioBatchTargets(project, "audio_ungenerated", [longTake, base])).toEqual(["b"]);
  });

  it("checks every paragraph member before deduplicating work to the first member", () => {
    const project = switchSpeechWorkspace(ensureSpeechWorkspaces(makeProject(["a", "b", "c", "d"])), "paragraph");
    project.speechWorkspace!.groups = [{ id: "group_ab", clipIds: ["a", "b"] }, { id: "group_cd", clipIds: ["c", "d"] }];
    adopt(voices(project)[0]);
    const candidates = voices(project).map((_, index) => makeParagraphCandidate(project, index));
    const before = structuredClone({ project, candidates });
    expect(getStudioBatchTargets(project, "audio_ungenerated", [])).toEqual(["a", "c"]);
    expect(getStudioBatchTargets(project, "audio_ungenerated", [candidates[0]])).toEqual(["a", "c"]);
    expect(getStudioBatchTargets(project, "audio_ungenerated", candidates.slice(0, 2))).toEqual(["c"]);
    expect(getStudioBatchTargets(project, "audio_ungenerated", candidates)).toEqual([]);
    expect({ project, candidates }).toEqual(before);
    voices(project)[1].text += "修改整段中的成员。";
    expect(getStudioBatchTargets(project, "audio_ungenerated", candidates)).toEqual(["a"]);
  });

  it("does not reuse a short-workspace take or an unsafe retained original as a usable paragraph result", () => {
    const project = switchSpeechWorkspace(ensureSpeechWorkspaces(makeProject(["a"])), "paragraph");
    const shortTake = makeCandidate(project);
    const passed = makeParagraphCandidate(project);
    const paragraph = passed.provenance.paragraph!;
    const review = AudioCandidateSchema.parse({ ...passed, asset: paragraph.sourceAsset,
      provenance: { ...passed.provenance, paragraph: { ...paragraph, checkStatus: "review", segments: [] } },
    });
    expect(getStudioBatchTargets(project, "audio_ungenerated", [shortTake, review])).toEqual(["a"]);
    expect(getStudioBatchTargets(project, "audio_ungenerated", [passed])).toEqual([]);
  });
});

describe("studio batch queue", () => {
  it("awaits each item before starting the next and emits independent progress snapshots", async () => {
    const first = deferred<"completed">();
    const second = deferred<"completed">();
    const calls: string[] = [];
    const progress: StudioBatchProgress[] = [];
    const controller = new AbortController();
    const queue = runStudioBatchQueue({ clipIds: ["a", "b"], signal: controller.signal,
      onItem: (id, signal) => { expect(signal).toBe(controller.signal); calls.push(id); return id === "a" ? first.promise : second.promise; },
      onProgress: (value) => progress.push(value) });
    expect(calls).toEqual(["a"]);
    first.resolve("completed");
    await flush();
    expect(calls).toEqual(["a", "b"]);
    second.resolve("completed");
    expect(await queue).toEqual({ state: "completed", total: 2, completed: 2, succeeded: 2, failed: 0, skipped: 0, failures: [] });
    expect(progress[0]).toEqual({ total: 2, completed: 0, succeeded: 0, failed: 0, skipped: 0 });
    expect(progress.filter((value) => value.currentClipId).map((value) => value.currentClipId)).toEqual(["a", "b"]);
    expect(progress.at(-1)).not.toHaveProperty("currentClipId");
    expect(progress.every((value) => value.completed === value.succeeded + value.failed + value.skipped)).toBe(true);
  });
  it("continues after failures, records messages and counts live eligibility skips", async () => {
    const calls: string[] = [];
    const result = await runStudioBatchQueue({ clipIds: ["a", "b", "c", "d"], signal: new AbortController().signal,
      onItem: async (id) => { calls.push(id); if (id === "a") throw new Error("模型暂不可用"); if (id === "c") throw "第二项失败"; return id === "b" ? "skipped" : "completed"; } });
    expect(calls).toEqual(["a", "b", "c", "d"]);
    expect(result).toEqual({ state: "completed", total: 4, completed: 4, succeeded: 1, failed: 2, skipped: 1,
      failures: [{ clipId: "a", message: "模型暂不可用" }, { clipId: "c", message: "第二项失败" }] });
  });

  it("stops dispatching after a storage failure while retaining completed results and counting the fatal item once", async () => {
    const progress: StudioBatchProgress[] = [];
    const onItem = vi.fn(async (id: string) => { if (id === "a") throw new Error("ordinary model error"); if (id === "c") throw new LocalStorageError(); return "completed" as const; });
    const result = await runStudioBatchQueue({ clipIds: ["a", "b", "c", "d"], signal: new AbortController().signal, onItem, onProgress: (value) => progress.push(value) });
    expect(onItem.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ state: "stopped", total: 4, completed: 3, succeeded: 1, failed: 2, skipped: 0,
      failures: [{ clipId: "a", message: "ordinary model error" }, { clipId: "c", message: "音频保存空间不足，请释放存储空间后重试。" }] });
    expect(result.total - result.completed).toBe(1);
    expect(progress.at(-1)).toEqual({ total: 4, completed: 3, succeeded: 1, failed: 2, skipped: 0 });
    expect(progress.filter((value) => value.currentClipId).map((value) => value.currentClipId)).toEqual(["a", "b", "c"]);
  });

  it("does not count a storage failure arriving after cancellation", async () => {
    const controller = new AbortController();
    const current = deferred<"completed">();
    const onItem = vi.fn((id: string) => id === "a" ? "completed" as const : current.promise);
    const queue = runStudioBatchQueue({ clipIds: ["a", "b", "c"], signal: controller.signal, onItem });
    await flush(); controller.abort(); current.reject(new LocalStorageError());
    expect(await queue).toEqual({ state: "cancelled", total: 3, completed: 1, succeeded: 1, failed: 0, skipped: 0, failures: [] });
    expect(onItem.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
  });
  it("cancels in-flight work without counting failures or starting more items", async () => {
    const controller = new AbortController();
    const current = deferred<"completed">();
    const onItem = vi.fn((id: string) => id === "a" ? "completed" as const : current.promise);
    const queue = runStudioBatchQueue({ clipIds: ["a", "b", "c"], signal: controller.signal, onItem });
    await flush();
    controller.abort();
    current.reject(new Error("request canceled"));
    expect(await queue).toEqual({ state: "cancelled", total: 3, completed: 1, succeeded: 1, failed: 0, skipped: 0, failures: [] });
    expect(onItem.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
  });
  it("does not count a late success after cancellation", async () => {
    const controller = new AbortController();
    const current = deferred<"completed">();
    const onItem = vi.fn(() => current.promise);
    const queue = runStudioBatchQueue({ clipIds: ["a", "b"], signal: controller.signal, onItem });
    controller.abort();
    current.resolve("completed");
    expect(await queue).toMatchObject({ state: "cancelled", completed: 0, failed: 0, succeeded: 0 });
    expect(onItem).toHaveBeenCalledTimes(1);
  });
  it("does not start pre-cancelled or empty queues", async () => {
    const controller = new AbortController();
    controller.abort();
    const onItem = vi.fn(() => "completed" as const);
    expect(await runStudioBatchQueue({ clipIds: ["a"], signal: controller.signal, onItem })).toMatchObject({ state: "cancelled", completed: 0, failed: 0 });
    expect(await runStudioBatchQueue({ clipIds: [], signal: new AbortController().signal, onItem })).toMatchObject({ state: "completed", total: 0, completed: 0 });
    expect(onItem).not.toHaveBeenCalled();
  });
});

describe("studio batch inter-item waiting", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("starts the five-second pause after work finishes and does not pause after the final success", async () => {
    const first = deferred<"completed">();
    const calls: Array<{ id: string; time: number }> = [];
    const progress: StudioBatchProgress[] = [];
    const queue = runStudioBatchQueue({ clipIds: ["a", "b"], signal: new AbortController().signal,
      interItemDelayMs: 5000,
      onItem: (id) => { calls.push({ id, time: Date.now() }); return id === "a" ? first.promise : "completed"; },
      onProgress: (value) => progress.push(value) });
    await vi.advanceTimersByTimeAsync(7000);
    expect(calls).toEqual([{ id: "a", time: 0 }]);
    expect(vi.getTimerCount()).toBe(0);
    first.resolve("completed");
    await flush();
    expect(progress.at(-1)).toEqual({ total: 2, completed: 1, succeeded: 1, failed: 0, skipped: 0, waitingBetweenItems: true });
    expect(progress.at(-1)).not.toHaveProperty("currentClipId");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([{ id: "a", time: 0 }, { id: "b", time: 12000 }]);
    expect(await queue).toMatchObject({ state: "completed", completed: 2, succeeded: 2, failed: 0 });
    expect(vi.getTimerCount()).toBe(0);
    expect(progress.filter((value) => !value.waitingBetweenItems).every((value) => !("waitingBetweenItems" in value))).toBe(true);
    expect(progress.at(-1)).not.toHaveProperty("waitingBetweenItems");
  });

  it("also waits five seconds after an ordinary failure before continuing", async () => {
    const calls: Array<{ id: string; time: number }> = [];
    const progress: StudioBatchProgress[] = [];
    const queue = runStudioBatchQueue({ clipIds: ["a", "b"], signal: new AbortController().signal,
      interItemDelayMs: 5000,
      onItem: (id) => { calls.push({ id, time: Date.now() }); if (id === "a") throw new Error("显卡暂不可用"); return "completed"; },
      onProgress: (value) => progress.push(value) });
    await flush();
    expect(progress.at(-1)).toMatchObject({ completed: 1, failed: 1, succeeded: 0, waitingBetweenItems: true });
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls).toEqual([{ id: "a", time: 0 }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([{ id: "a", time: 0 }, { id: "b", time: 5000 }]);
    expect(await queue).toMatchObject({ state: "completed", completed: 2, succeeded: 1, failed: 1,
      failures: [{ clipId: "a", message: "显卡暂不可用" }] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["completed", "failed"] as const)("finishes a single %s item without creating a trailing wait", async (outcome) => {
    const settled = vi.fn();
    const onItem = vi.fn(() => { if (outcome === "failed") throw new Error("模型失败"); return "completed" as const; });
    const queue = runStudioBatchQueue({ clipIds: ["last"], signal: new AbortController().signal, interItemDelayMs: 5000, onItem });
    void queue.then(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(await queue).toMatchObject({ state: "completed", completed: 1, succeeded: Number(outcome === "completed"), failed: Number(outcome === "failed") });
  });

  it("does not add waits for skipped items that launch no model task", async () => {
    const calls: Array<{ id: string; time: number }> = [];
    const queue = runStudioBatchQueue({ clipIds: ["skip_first", "a", "skip_middle", "b"], signal: new AbortController().signal,
      interItemDelayMs: 5000,
      onItem: (id) => { calls.push({ id, time: Date.now() }); return id.startsWith("skip") ? "skipped" : "completed"; } });
    await flush();
    expect(calls).toEqual([{ id: "skip_first", time: 0 }, { id: "a", time: 0 }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([{ id: "skip_first", time: 0 }, { id: "a", time: 0 }, { id: "skip_middle", time: 5000 }, { id: "b", time: 5000 }]);
    expect(await queue).toMatchObject({ state: "completed", completed: 4, succeeded: 2, skipped: 2, failed: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an active pause immediately and clears its timer and abort listener", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const onItem = vi.fn(() => "completed" as const);
    const settled = vi.fn();
    const queue = runStudioBatchQueue({ clipIds: ["a", "b"], signal: controller.signal, interItemDelayMs: 5000, onItem });
    void queue.then(settled);
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await flush();
    expect(settled).toHaveBeenCalledOnce();
    expect(await queue).toMatchObject({ state: "cancelled", completed: 1, succeeded: 1, failed: 0 });
    expect(onItem).toHaveBeenCalledExactlyOnceWith("a", controller.signal);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    await vi.advanceTimersByTimeAsync(10000);
    expect(onItem).toHaveBeenCalledOnce();
  });

  it("stops on a storage failure immediately rather than entering a pause", async () => {
    const onItem = vi.fn(() => { throw new LocalStorageError(); });
    const settled = vi.fn();
    const progress: StudioBatchProgress[] = [];
    const queue = runStudioBatchQueue({ clipIds: ["a", "b"], signal: new AbortController().signal,
      interItemDelayMs: 5000, onItem, onProgress: (value) => progress.push(value) });
    void queue.then(settled);
    await flush();
    expect(settled).toHaveBeenCalledOnce();
    expect(await queue).toMatchObject({ state: "stopped", completed: 1, failed: 1 });
    expect(onItem).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(progress.some((value) => value.waitingBetweenItems)).toBe(false);
  });

  it("keeps the default zero-delay storyboard queue immediate", async () => {
    const project = makeProject(["a", "b"]);
    voices(project).forEach(adopt);
    const calls: Array<{ id: string; time: number }> = [];
    const progress: StudioBatchProgress[] = [];
    const result = await runStudioBatchQueue({ clipIds: getStudioBatchTargets(project, "storyboard_all"),
      signal: new AbortController().signal,
      onItem: (id) => { calls.push({ id, time: Date.now() }); return "completed"; },
      onProgress: (value) => progress.push(value) });
    expect(result).toMatchObject({ state: "completed", completed: 2, succeeded: 2 });
    expect(calls).toEqual([{ id: "a", time: 0 }, { id: "b", time: 0 }]);
    expect(vi.getTimerCount()).toBe(0);
    expect(progress.some((value) => value.waitingBetweenItems)).toBe(false);
  });
});

const request: GenerateClipRequest = { project: demoProject, clipId: "voice_001", reason: "generate" };
function job(status: GenerationJobSnapshot["status"] = "generating"): GenerationJobSnapshot {
  return { jobId: "job_1", clipId: request.clipId, status, progress: 50, createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" };
}
function succeeded(): GenerationJobUpdate {
  return { type: "succeeded", job: job("succeeded"), asset: { assetId: "new_take", uri: "asset://clip/new_take", duration: 3 } };
}
function controlledBridge() {
  const started = deferred<{ jobId: string }>();
  let update!: (value: GenerationJobUpdate) => void;
  const bridge: GenerationBridge = {
    generateClip: vi.fn((_request, onUpdate) => { update = onUpdate; return started.promise; }),
    generateProjectMix: vi.fn(async () => ({ jobId: "unused" })),
    cancelGeneration: vi.fn(async () => {}),
  };
  return { bridge, started, update: (value: GenerationJobUpdate) => update(value) };
}

describe("waiting for batch voice generation", () => {
  it("awaits a real mock bridge terminal event even when startup already resolved", async () => {
    vi.useFakeTimers();
    try {
      const onUpdate = vi.fn();
      const bridge = createMockGenerationBridge({ stepMs: 10 });
      const terminal = waitForStudioVoiceGeneration({ bridge, request, signal: new AbortController().signal, onUpdate });
      const settled = vi.fn();
      void terminal.then(settled);
      await flush();
      expect(settled).not.toHaveBeenCalled();
      expect(onUpdate.mock.calls[0][0].type).toBe("snapshot");
      await vi.runAllTimersAsync();
      await terminal;
      expect(onUpdate.mock.calls.at(-1)![0].type).toBe("succeeded");
      expect(settled).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it.each(["candidate", "succeeded"] as const)("delivers early %s before resolving and ignores later updates", async (type) => {
    const controlled = controlledBridge();
    const controller = new AbortController();
    const events: string[] = [];
    const onUpdate = vi.fn((value: GenerationJobUpdate) => events.push(value.type));
    const terminal = waitForStudioVoiceGeneration({ bridge: controlled.bridge, request, signal: controller.signal, onUpdate });
    void terminal.then(() => events.push("resolved"));
    controlled.update(type === "candidate" ? { type, job: job("succeeded"), candidate: makeCandidate(makeProject(["a"])) } : succeeded());
    await terminal;
    expect(events).toEqual([type, "resolved"]);
    controlled.started.resolve({ jobId: "job_1" });
    controlled.update({ type: "snapshot", job: job() });
    controlled.update(succeeded());
    controller.abort();
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(controlled.bridge.cancelGeneration).not.toHaveBeenCalled();
  });
  it("delivers failed/canceled terminal events before rejecting with the appropriate error", async () => {
    for (const type of ["failed", "canceled"] as const) {
      const controlled = controlledBridge();
      const onUpdate = vi.fn();
      const terminal = waitForStudioVoiceGeneration({ bridge: controlled.bridge, request, signal: new AbortController().signal, onUpdate });
      const rejection = expect(terminal).rejects.toMatchObject(type === "failed" ? { message: "GPU unavailable" } : { name: "AbortError" });
      controlled.update(type === "failed" ? { type, job: job("failed"), error: "GPU unavailable" } : { type, job: job("canceled") });
      await rejection;
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate.mock.calls[0][0].type).toBe(type);
      controlled.update(succeeded());
      expect(onUpdate).toHaveBeenCalledTimes(1);
    }
  });

  it("delivers a coded failed terminal event then rejects with the typed storage error", async () => {
    const controlled = controlledBridge(); const onUpdate = vi.fn();
    const terminal = waitForStudioVoiceGeneration({ bridge: controlled.bridge, request, signal: new AbortController().signal, onUpdate });
    const failure = terminal.catch((error: unknown) => error);
    controlled.update({ type: "failed", job: job("failed"), error: "storage full", errorCode: "INSUFFICIENT_STORAGE" });
    expect(await failure).toBeInstanceOf(LocalStorageError);
    expect(await failure).toMatchObject({ code: "INSUFFICIENT_STORAGE", message: "音频保存空间不足，请释放存储空间后重试。" });
    expect(onUpdate).toHaveBeenCalledOnce(); expect(onUpdate.mock.calls[0][0].errorCode).toBe("INSUFFICIENT_STORAGE");
    controlled.update(succeeded()); expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("normalizes a coded startup failure to a typed storage error", async () => {
    const controlled = controlledBridge();
    const terminal = waitForStudioVoiceGeneration({ bridge: controlled.bridge, request, signal: new AbortController().signal, onUpdate: vi.fn() });
    const failure = terminal.catch((error: unknown) => error);
    controlled.started.reject(Object.assign(new Error("write failed"), { code: "ENOSPC" }));
    expect(await failure).toBeInstanceOf(LocalStorageError);
    expect(await failure).toMatchObject({ code: "INSUFFICIENT_STORAGE", statusCode: 507 });
  });
  it("rejects startup errors and removes the abort listener", async () => {
    const controlled = controlledBridge();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const onUpdate = vi.fn();
    const terminal = waitForStudioVoiceGeneration({ bridge: controlled.bridge, request, signal: controller.signal, onUpdate });
    const rejection = expect(terminal).rejects.toThrow("startup failed");
    controlled.started.reject(new Error("startup failed"));
    await rejection;
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    controlled.update(succeeded());
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it("settles immediately on cancellation before startup and cancels the later job ID", async () => {
    const controlled = controlledBridge();
    const controller = new AbortController();
    const onUpdate = vi.fn();
    const terminal = waitForStudioVoiceGeneration({ bridge: controlled.bridge, request, signal: controller.signal, onUpdate });
    const rejection = expect(terminal).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(controlled.bridge.cancelGeneration).not.toHaveBeenCalled();
    controlled.started.resolve({ jobId: "job_1" });
    await flush();
    expect(controlled.bridge.cancelGeneration).toHaveBeenCalledExactlyOnceWith("job_1");
    controlled.update(succeeded());
    expect(onUpdate).not.toHaveBeenCalled();
    expect(controlled.bridge.cancelGeneration).toHaveBeenCalledTimes(1);
  });
  it.each(["snapshot", "started"] as const)("cancels the known %s job and ignores synchronous cancellation callbacks", async (source) => {
    const controlled = controlledBridge();
    const controller = new AbortController();
    const onUpdate = vi.fn();
    vi.mocked(controlled.bridge.cancelGeneration).mockImplementation(async () => { controlled.update({ type: "canceled", job: job("canceled") }); });
    const terminal = waitForStudioVoiceGeneration({ bridge: controlled.bridge, request, signal: controller.signal, onUpdate });
    const rejection = expect(terminal).rejects.toMatchObject({ name: "AbortError" });
    if (source === "snapshot") controlled.update({ type: "snapshot", job: job() });
    else { controlled.started.resolve({ jobId: "job_1" }); await flush(); }
    controller.abort();
    await rejection;
    expect(controlled.bridge.cancelGeneration).toHaveBeenCalledExactlyOnceWith("job_1");
    controlled.update(succeeded());
    expect(onUpdate).toHaveBeenCalledTimes(source === "snapshot" ? 1 : 0);
    controlled.started.resolve({ jobId: "job_1" });
    await flush();
    expect(controlled.bridge.cancelGeneration).toHaveBeenCalledTimes(1);
  });
  it("does not launch a bridge when already cancelled", async () => {
    const controlled = controlledBridge();
    const controller = new AbortController();
    controller.abort();
    await expect(waitForStudioVoiceGeneration({ bridge: controlled.bridge, request, signal: controller.signal, onUpdate: vi.fn() })).rejects.toMatchObject({ name: "AbortError" });
    expect(controlled.bridge.generateClip).not.toHaveBeenCalled();
  });
});
