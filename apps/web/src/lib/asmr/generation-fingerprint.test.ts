import { describe, expect, it } from "vitest";

import {
  getClipGenerationFingerprint,
  isCurrentClipGenerationFingerprint,
} from "./generation-fingerprint";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "./generation-project-state";
import { demoProject } from "./mock-project";
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
});
