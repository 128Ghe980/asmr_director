import { describe, expect, it } from "vitest";

import type { GeneratedAssetResult } from "./generation-bridge";
import { commitGenerationSuccess } from "./generation-project-state";
import { demoProject } from "./mock-project";
import {
  canGenerateProjectMix,
  commitProjectMixFailure,
  commitProjectMixSuccess,
  getMissingProjectMixClipIds,
  getWavExport,
} from "./project-mix-state";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

function cloneProject(): AsmrProject {
  return structuredClone(demoProject);
}

function findClip(project: AsmrProject, clipId: string): TimelineClip {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error(`Missing clip ${clipId}`);
  }

  return clip;
}

function updateClip(
  project: AsmrProject,
  clipId: string,
  update: (clip: TimelineClip) => void,
): AsmrProject {
  const nextProject = structuredClone(project);
  update(findClip(nextProject, clipId));

  return nextProject;
}

function generateAllClips(project = cloneProject()): AsmrProject {
  return flattenClips(project).reduce(
    (nextProject, clip) =>
      commitGenerationSuccess(nextProject, clip.id, {
        assetId: `${clip.id}_asset`,
        uri: `asset://clip/${clip.id}_asset`,
        duration: clip.duration,
      }),
    project,
  );
}

const mixAsset: GeneratedAssetResult = {
  assetId: "asmr_demo_001_wav_20260710T000000000Z_abcd1234",
  uri: "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
  duration: 210,
};

describe("project mix state", () => {
  it("lists every audio-bearing clip without a local generated asset", () => {
    const project = cloneProject();

    expect(getMissingProjectMixClipIds(project)).toEqual(
      flattenClips(project).map((clip) => clip.id),
    );
    expect(canGenerateProjectMix(project)).toBe(false);
  });

  it("allows project mix only when every audio-bearing clip has asset://clip", () => {
    const generated = generateAllClips();
    const staleClip = updateClip(generated, "voice_001", (clip) => {
      clip.asset.uri = "mock://asset/voice_001/job_1";
    });
    const pendingClip = updateClip(generated, "breath_001", (clip) => {
      clip.generation.status = "asset_pending";
    });

    expect(getMissingProjectMixClipIds(generated)).toEqual([]);
    expect(canGenerateProjectMix(generated)).toBe(true);
    expect(getMissingProjectMixClipIds(staleClip)).toEqual(["voice_001"]);
    expect(canGenerateProjectMix(staleClip)).toBe(false);
    expect(getMissingProjectMixClipIds(pendingClip)).toEqual(["breath_001"]);
    expect(canGenerateProjectMix(pendingClip)).toBe(false);
  });

  it("commits successful wav mix into an existing or new wav export", () => {
    const project = cloneProject();
    const committed = commitProjectMixSuccess(project, mixAsset);
    const nextMixAsset: GeneratedAssetResult = {
      assetId: "asmr_demo_001_wav_20260710T000100000Z_dcba4321",
      uri: "asset://mix/asmr_demo_001_wav_20260710T000100000Z_dcba4321",
      duration: 210,
    };
    const updated = commitProjectMixSuccess(committed, nextMixAsset);

    expect(getWavExport(project)).toBeUndefined();
    expect(getWavExport(committed)).toEqual({
      type: "wav",
      status: "exported",
      uri: mixAsset.uri,
    });
    expect(updated.exports).toHaveLength(committed.exports.length);
    expect(getWavExport(updated)).toEqual({
      type: "wav",
      status: "exported",
      uri: nextMixAsset.uri,
    });
  });

  it("preserves previous exported mix when remix fails", () => {
    const committed = commitProjectMixSuccess(cloneProject(), mixAsset);
    const failedRemix = commitProjectMixFailure(committed, {
      reason: "remix",
      error: "Render failed",
    });

    expect(getWavExport(failedRemix)).toEqual(getWavExport(committed));
  });

  it("clears wav export on first mix failure", () => {
    const failedMix = commitProjectMixFailure(cloneProject(), {
      reason: "mix",
      error: "Missing clip assets",
    });

    expect(getWavExport(failedMix)).toEqual({
      type: "wav",
      status: "export_failed",
      uri: null,
    });
  });
});
