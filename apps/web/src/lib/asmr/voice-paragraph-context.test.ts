import { describe, expect, it } from "vitest";
import { getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { demoProject } from "./mock-project";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";
import { getVoiceParagraphContext } from "./voice-paragraph-context";

function fixture() {
  const project = switchSpeechWorkspace(ensureSpeechWorkspaces(structuredClone(demoProject)), "paragraph");
  const clips = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  project.speechWorkspace!.groups = [{ id: "group-a", clipIds: clips.slice(0, 2).map((clip) => clip.id) },
    ...clips.slice(2).map((clip) => ({ id: `group-${clip.id}`, clipIds: [clip.id] }))];
  return { project, clips };
}

describe("independent paragraph generation context", () => {
  it("uses stored group membership and active sources without touching the short bank", () => {
    const { project, clips } = fixture();
    const short = JSON.stringify(project.speechWorkspace!.short);
    const context = getVoiceParagraphContext(project, clips[0].id)!;
    expect(context.groupId).toBe("group-a");
    expect(context.text).toBe(clips[0].text + clips[1].text);
    const fingerprint = getVoiceCandidateSourceFingerprint(clips[0], undefined, context);
    clips[1].text = "调整了整段里的第二句。";
    expect(getVoiceCandidateSourceFingerprint(clips[0], undefined, getVoiceParagraphContext(project, clips[0].id))).not.toBe(fingerprint);
    expect(JSON.stringify(project.speechWorkspace!.short)).toBe(short);
  });
  it.each(["missing", "silent", "duplicate"])("refuses a stale group definition with a %s member", (change) => {
    const { project, clips } = fixture();
    if (change === "missing") project.speechWorkspace!.groups[0].clipIds[1] = "removed_clip";
    if (change === "silent") clips[1].kind = "silent";
    if (change === "duplicate") project.speechWorkspace!.groups[0].clipIds[1] = clips[0].id;
    expect(getVoiceParagraphContext(project, clips[0].id)).toBeUndefined();
  });
});
