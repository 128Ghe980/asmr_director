import { describe, expect, it } from "vitest";

import type { GeneratedAssetResult } from "./generation-bridge";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "./generation-project-state";
import { demoProject } from "./mock-project";
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

const asset: GeneratedAssetResult = {
  assetId: "mock_voice_001_job_1",
  uri: "mock://asset/voice_001/job_1",
  duration: 7.5,
};

describe("generation project state", () => {
  it("commits successful generation asset metadata without mutating the original project", () => {
    const project = cloneProject();
    const updated = commitGenerationSuccess(project, "voice_001", asset);
    const originalClip = findClip(project, "voice_001");
    const updatedClip = findClip(updated, "voice_001");

    expect(updated).not.toBe(project);
    expect(originalClip.generation.status).toBe("asset_pending");
    expect(originalClip.asset.uri).toBeNull();
    expect(updatedClip.generation.status).toBe("asset_generated");
    expect(updatedClip.generation.error).toBeNull();
    expect(updatedClip.asset).toEqual({
      asset_id: asset.assetId,
      uri: asset.uri,
      duration: asset.duration,
    });
  });

  it("commits normal generation failure as a durable failed state", () => {
    const project = cloneProject();
    const updated = commitGenerationFailure(project, "voice_001", {
      reason: "generate",
      error: "Mock generation failed",
    });
    const updatedClip = findClip(updated, "voice_001");

    expect(updatedClip.generation.status).toBe("asset_failed");
    expect(updatedClip.generation.error).toBe("Mock generation failed");
    expect(updatedClip.asset).toEqual({
      asset_id: null,
      uri: null,
      duration: null,
    });
  });

  it("preserves a previous generated asset when regeneration fails", () => {
    const generated = commitGenerationSuccess(
      cloneProject(),
      "voice_001",
      asset,
    );
    const failedRegeneration = commitGenerationFailure(generated, "voice_001", {
      reason: "regenerate",
      error: "Mock generation failed",
    });
    const updatedClip = findClip(failedRegeneration, "voice_001");

    expect(updatedClip.generation.status).toBe("asset_generated");
    expect(updatedClip.generation.error).toBeNull();
    expect(updatedClip.asset.uri).toBe(asset.uri);
  });

  it("returns the same project when the clip is missing", () => {
    const project = cloneProject();

    expect(commitGenerationSuccess(project, "missing", asset)).toBe(project);
    expect(
      commitGenerationFailure(project, "missing", {
        reason: "generate",
        error: "Missing",
      }),
    ).toBe(project);
  });
});
