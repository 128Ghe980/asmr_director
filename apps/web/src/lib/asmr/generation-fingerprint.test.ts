import { describe, expect, it } from "vitest";

import {
  getClipGenerationFingerprint,
  getProjectMixFingerprint,
  isCurrentClipGenerationFingerprint,
  isCurrentProjectMixFingerprint,
} from "./generation-fingerprint";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "./generation-project-state";
import { demoProject } from "./mock-project";
import { commitProjectMixSuccess } from "./project-mix-state";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

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

function updateProject(
  project: AsmrProject,
  update: (project: AsmrProject) => void,
): AsmrProject {
  const nextProject = structuredClone(project);
  update(nextProject);

  return nextProject;
}

function generateAllClips(project = demoProject): AsmrProject {
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

describe("generation fingerprint", () => {
  it("ignores runtime, durable generation, and asset fields", () => {
    const original = findClip(demoProject, "voice_001");
    const generatedProject = commitGenerationSuccess(demoProject, "voice_001", {
      assetId: "mock_voice_001_job_1",
      uri: "mock://asset/voice_001/job_1",
      duration: 7.5,
    });
    const failedProject = commitGenerationFailure(
      generatedProject,
      "voice_001",
      {
        reason: "regenerate",
        error: "Mock generation failed",
      },
    );

    expect(getClipGenerationFingerprint(findClip(generatedProject, "voice_001"))).toBe(
      getClipGenerationFingerprint(original),
    );
    expect(getClipGenerationFingerprint(findClip(failedProject, "voice_001"))).toBe(
      getClipGenerationFingerprint(original),
    );
  });

  it("changes when generation-relevant clip inputs change", () => {
    const original = findClip(demoProject, "voice_001");
    const originalFingerprint = getClipGenerationFingerprint(original);
    const changedText = updateClip(demoProject, "voice_001", (clip) => {
      if (clip.type === "voice") {
        clip.text = `${clip.text} more`;
      }
    });
    const changedTiming = updateClip(demoProject, "voice_001", (clip) => {
      clip.duration += 1;
    });
    const changedDirectorSettings = updateClip(
      demoProject,
      "voice_001",
      (clip) => {
        clip.position.pan = 0.1;
        clip.volume_db = -9;
      },
    );

    expect(getClipGenerationFingerprint(findClip(changedText, "voice_001"))).not.toBe(
      originalFingerprint,
    );
    expect(
      getClipGenerationFingerprint(findClip(changedTiming, "voice_001")),
    ).not.toBe(originalFingerprint);
    expect(
      getClipGenerationFingerprint(
        findClip(changedDirectorSettings, "voice_001"),
      ),
    ).not.toBe(originalFingerprint);
  });

  it("rejects stale terminal commits when the current clip fingerprint changed", () => {
    const startedFingerprint = getClipGenerationFingerprint(
      findClip(demoProject, "voice_001"),
    );
    const editedProject = updateClip(demoProject, "voice_001", (clip) => {
      clip.duration += 1;
    });

    expect(
      isCurrentClipGenerationFingerprint(
        editedProject,
        "voice_001",
        startedFingerprint,
      ),
    ).toBe(false);
    expect(
      isCurrentClipGenerationFingerprint(
        demoProject,
        "voice_001",
        startedFingerprint,
      ),
    ).toBe(true);
  });

  it("changes project mix fingerprint when clip timing, mixing, or asset uri changes", () => {
    const generated = generateAllClips();
    const originalFingerprint = getProjectMixFingerprint(generated);
    const changedTiming = updateClip(generated, "voice_001", (clip) => {
      clip.start += 0.5;
    });
    const changedMixing = updateProject(generated, (project) => {
      project.timeline.mixing.target_lufs =
        project.timeline.mixing.target_lufs === -18 ? -17 : -18;
    });
    const changedAssetUri = updateClip(generated, "voice_001", (clip) => {
      clip.asset.uri = "asset://clip/voice_001_other_asset";
    });

    expect(getProjectMixFingerprint(changedTiming)).not.toBe(
      originalFingerprint,
    );
    expect(getProjectMixFingerprint(changedMixing)).not.toBe(
      originalFingerprint,
    );
    expect(getProjectMixFingerprint(changedAssetUri)).not.toBe(
      originalFingerprint,
    );
  });

  it("ignores wav export uri when computing project mix fingerprint", () => {
    const generated = generateAllClips();
    const firstMix = commitProjectMixSuccess(generated, {
      assetId: "asmr_demo_001_wav_20260710T000000000Z_abcd1234",
      uri: "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
      duration: generated.duration,
    });
    const secondMix = commitProjectMixSuccess(firstMix, {
      assetId: "asmr_demo_001_wav_20260710T000100000Z_dcba4321",
      uri: "asset://mix/asmr_demo_001_wav_20260710T000100000Z_dcba4321",
      duration: generated.duration,
    });

    expect(getProjectMixFingerprint(firstMix)).toBe(
      getProjectMixFingerprint(generated),
    );
    expect(getProjectMixFingerprint(secondMix)).toBe(
      getProjectMixFingerprint(generated),
    );
  });

  it("rejects stale project mix commits when the current project mix fingerprint changed", () => {
    const generated = generateAllClips();
    const startedFingerprint = getProjectMixFingerprint(generated);
    const editedProject = updateClip(generated, "sfx_blanket_001", (clip) => {
      clip.duration += 0.5;
    });

    expect(
      isCurrentProjectMixFingerprint(editedProject, startedFingerprint),
    ).toBe(false);
    expect(
      isCurrentProjectMixFingerprint(generated, startedFingerprint),
    ).toBe(true);
  });
});
