import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import { getProjectMixFingerprint, isCurrentProjectMixFingerprint } from "./generation-fingerprint";
import { ensureSpeechWorkspaces, getSpeechWorkspaceProject, switchSpeechWorkspace, syncSharedSpeechScript } from "./speech-workspace";

describe("mixed audio stays tied to its workspace source", () => {
  it("rejects a late mix after source edits retain the same adopted WAV, including repeated edits", () => {
    const previous = ensureSpeechWorkspaces(structuredClone(demoProject));
    const voice = previous.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
    voice.asset = { asset_id: "original", uri: "asset://clip/original", duration: voice.duration };
    const started = getProjectMixFingerprint(previous);
    const next = structuredClone(previous);
    next.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0].text += "慢慢来。";
    const changed = syncSharedSpeechScript(previous, next);
    expect(changed.timeline.tracks[0].clips[0].asset).toEqual(voice.asset);
    expect(isCurrentProjectMixFingerprint(changed, started)).toBe(false);
    const duringStale = getProjectMixFingerprint(changed);
    const another = structuredClone(changed);
    another.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0].text += "不要着急。";
    expect(isCurrentProjectMixFingerprint(syncSharedSpeechScript(changed, another), duringStale)).toBe(false);
  });

  it("keeps another workspace's running mix valid through a private wait edit", () => {
    const original = switchSpeechWorkspace(ensureSpeechWorkspaces(structuredClone(demoProject)), "paragraph");
    const paragraphMix = getProjectMixFingerprint(original);
    const short = switchSpeechWorkspace(original, "short");
    const next = structuredClone(short);
    next.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0].pause_after = 3;
    const updated = syncSharedSpeechScript(short, next);
    expect(isCurrentProjectMixFingerprint(getSpeechWorkspaceProject(updated, "paragraph"), paragraphMix)).toBe(true);
  });

  it("distinguishes a silent slot from speech using the same historical asset and timing", () => {
    const original = structuredClone(demoProject);
    const fingerprint = getProjectMixFingerprint(original);
    original.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0].kind = "silent";
    expect(isCurrentProjectMixFingerprint(original, fingerprint)).toBe(false);
  });
});
