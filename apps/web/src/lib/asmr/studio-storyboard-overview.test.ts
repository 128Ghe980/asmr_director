import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import type { AsmrProject, VoiceClip } from "./schema";
import { getStudioStoryboardProgress } from "./studio-storyboard-overview";
import { createClipH3Prompt, createClipVideoSourceFingerprint, getPreviousClipPromptFingerprint } from "./video-plan";

function voices(project: AsmrProject): VoiceClip[] {
  return project.timeline.tracks.find(track => track.track_type === "voice")!.clips;
}
function projectWithShots() {
  const project = structuredClone(demoProject);
  voices(project).splice(3);
  project.videoPlan = { version: 1, sceneDescription: "温暖安静的室内。", shots: {} };
  for (const clip of voices(project)) {
    clip.generation.status = "asset_generated";
    clip.asset = { asset_id: `take_${clip.id}`, uri: `asset://clip/take_${clip.id}`, duration: 3.21 };
    project.videoPlan.shots[clip.id] = {
      version: 1, promptFormat: "minimax-h3", clipId: clip.id,
      sourceFingerprint: createClipVideoSourceFingerprint(project, clip.id),
      audio: { assetId: clip.asset.asset_id!, uri: clip.asset.uri!, duration: 3.21 },
      title: "陪伴", visual: "S1 sits at a table.", action: "S1 rests one hand on the table.", camera: "Static medium shot.",
    };
  }
  return project;
}

describe("studio storyboard progress", () => {
  it("counts nonempty voice paragraphs once and provides pending states for every empty voice", () => {
    const project = projectWithShots();
    const [ready, pending, stale] = voices(project);
    delete project.videoPlan!.shots[pending.id];
    stale.text += "修改。";
    const empty = structuredClone(ready);
    empty.id = "empty_voice"; empty.text = " \n "; empty.start = 30;
    voices(project).push(empty);
    const before = structuredClone(project);
    expect(getStudioStoryboardProgress(project)).toEqual({
      total: 3, ready: 1, pending: 1, needsUpdate: 1,
      byClip: { [ready.id]: "ready", [pending.id]: "pending", [stale.id]: "needs_update", [empty.id]: "pending" },
    });
    expect(project).toEqual(before);
  });

  it("marks every voice pending when no plan exists and ignores nonvoice shots", () => {
    const project = structuredClone(demoProject);
    expect(getStudioStoryboardProgress(project)).toMatchObject({ total: 4, ready: 0, pending: 4, needsUpdate: 0 });
    const withShots = projectWithShots();
    withShots.videoPlan!.shots.foreign_clip = structuredClone(Object.values(withShots.videoPlan!.shots)[0]);
    expect(getStudioStoryboardProgress(withShots)).toMatchObject({ total: 3, ready: 3, pending: 0, needsUpdate: 0 });
  });

  it.each(["title", "visual", "action", "camera", "scene", "unadopted", "invalid"])("marks saved %s storyboards for update and agrees with prompt usability", (kind) => {
    const project = projectWithShots();
    const clip = voices(project)[0];
    const shot = project.videoPlan!.shots[clip.id];
    if (["title", "visual", "action", "camera"].includes(kind)) shot[kind as "title"] = " ";
    if (kind === "scene") {
      project.videoPlan!.sceneDescription = " ";
      shot.sourceFingerprint = createClipVideoSourceFingerprint(project, clip.id);
    }
    if (kind === "unadopted") clip.generation.status = "asset_pending";
    if (kind === "invalid") shot.audio!.duration = 0;
    expect(getStudioStoryboardProgress(project).byClip[clip.id]).toBe("needs_update");
    expect(() => createClipH3Prompt(project, clip.id)).toThrow();
  });

  it("follows linked predecessor freshness while retaining independent modes and ignoring next-generation preferences", () => {
    const project = projectWithShots();
    const [first, second, third] = voices(project);
    const linked = project.videoPlan!.shots[second.id];
    linked.previousClipId = first.id;
    linked.previousPromptFingerprint = getPreviousClipPromptFingerprint(project, second.id);
    linked.referenceMode = "continuous";
    project.videoPlan!.shots[third.id].referenceMode = "new";
    project.videoPlan!.referenceModes = { [second.id]: "new", [third.id]: "continuous" };
    expect(getStudioStoryboardProgress(project).ready).toBe(3);
    project.videoPlan!.shots[first.id].camera += " A hand edit.";
    expect(getStudioStoryboardProgress(project)).toMatchObject({
      ready: 2, needsUpdate: 1,
      byClip: { [first.id]: "ready", [second.id]: "needs_update", [third.id]: "ready" },
    });
    project.videoPlan!.shots[first.id].camera = "";
    expect(getStudioStoryboardProgress(project)).toMatchObject({ ready: 1, needsUpdate: 2 });
  });
});
