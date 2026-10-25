import { describe, expect, it } from "vitest";
import { processedProject } from "../../components/studio/audio-post-processing-test-fixture";
import { getClipGenerationFingerprint, getProjectMixFingerprint, isCurrentProjectMixFingerprint } from "./generation-fingerprint";

describe("explicit voice delivery mix identity", () => {
  it("keeps partial work on the raw identity and changes only for a complete processed set", () => {
    const raw = processedProject(0), partial = processedProject(1), complete = processedProject();
    const original = getProjectMixFingerprint(raw);
    expect(getProjectMixFingerprint(partial)).toBe(original);
    expect(getProjectMixFingerprint(complete)).not.toBe(original);
    expect(JSON.parse(original).voice_delivery).toEqual({ version: "explicit-voice-v1", mode: "original" });
    const delivered = JSON.parse(getProjectMixFingerprint(complete)).voice_delivery;
    expect(delivered.mode).toBe("processed");
    expect(delivered.processed).toHaveLength(2);
    expect(delivered.processed[0]).toMatchObject({ clipId: "voice_001", asset: { uri: "asset://clip/processed_0", duration: 1.65 }, outputSha256: "b".repeat(64) });
  });

  it.each(["asset", "duration", "sha"])("invalidates a completed mix when the actual processed %s changes", field => {
    const project = processedProject(), previous = getProjectMixFingerprint(project);
    const receipt = project.audioPostProcessing!.results.voice_001;
    if (field === "asset") receipt.asset = { ...receipt.asset, assetId: "replacement", uri: "asset://clip/replacement" };
    if (field === "duration") receipt.asset.duration += .2;
    if (field === "sha") receipt.outputSha256 = "c".repeat(64);
    expect(isCurrentProjectMixFingerprint(project, previous)).toBe(false);
  });

  it("returns to the whole raw set when the stored plan becomes stale", () => {
    const raw = processedProject(0), complete = processedProject();
    const completed = getProjectMixFingerprint(complete);
    complete.videoPlan!.shots.voice_001.action = "Stands by the window";
    expect(getProjectMixFingerprint(complete)).toBe(getProjectMixFingerprint(raw));
    expect(isCurrentProjectMixFingerprint(complete, completed)).toBe(false);
  });

  it.each([true, false])("invalidates legacy implicit delivery mixes even with binaural=%s", binaural => {
    const project = processedProject(0); project.timeline.mixing.binaural = binaural;
    const old = JSON.parse(getProjectMixFingerprint(project)); delete old.voice_delivery;
    expect(isCurrentProjectMixFingerprint(project, JSON.stringify(old))).toBe(false);
  });

  it("does not version projects without speech or change clip-generation identities", () => {
    const raw = processedProject(0), complete = processedProject();
    const first = (project: typeof raw) => project.timeline.tracks.find(track => track.track_type === "voice")!.clips[0];
    expect(getClipGenerationFingerprint(first(raw))).toBe(getClipGenerationFingerprint(first(complete)));
    raw.timeline.tracks = raw.timeline.tracks.map(track => track.track_type === "voice" ? { ...track, clips: [] } : track);
    expect(JSON.parse(getProjectMixFingerprint(raw)).voice_delivery).toBeUndefined();
  });
});
