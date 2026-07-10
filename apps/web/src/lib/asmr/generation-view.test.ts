import { describe, expect, it } from "vitest";

import type { GenerationJobSnapshot } from "./generation-bridge";
import { getGenerationView } from "./generation-view";
import {
  emptyGenerationRuntimeState,
  upsertGenerationJob,
} from "./generation-runtime";
import {
  commitGenerationFailure,
  commitGenerationSuccess,
} from "./generation-project-state";
import { getProjectMixFingerprint } from "./generation-fingerprint";
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

function generateAllClipAssets(project = demoProject): AsmrProject {
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

const generatingJob: GenerationJobSnapshot = {
  jobId: "job_1",
  clipId: "voice_001",
  status: "generating",
  progress: 42,
  message: "生成中",
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:01.000Z",
};

const projectMixJob: GenerationJobSnapshot = {
  jobId: "mix_job_1",
  clipId: "project_mix:wav",
  target: { type: "project_mix", exportType: "wav" },
  status: "generating",
  progress: 66,
  message: "Mixing",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:01.000Z",
};

function makeRuntimeJob(
  status: GenerationJobSnapshot["status"],
  overrides: Partial<GenerationJobSnapshot> = {},
): GenerationJobSnapshot {
  return {
    ...generatingJob,
    status,
    ...overrides,
  };
}

describe("generation view", () => {
  it("shows a no-op control when no clip is selected", () => {
    const view = getGenerationView({
      project: demoProject,
      selectedClip: undefined,
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "none",
      label: "无片段",
      disabled: true,
      disabledReason: "未选择片段",
      statusLabel: "无片段",
    });
    expect(view.selectedClipPreview).toEqual({
      canPlay: false,
      label: "暂无音频",
    });
  });

  it("shows generate action for a valid pending selected clip", () => {
    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "generate",
      label: "生成",
      disabled: false,
      statusLabel: "待生成",
    });
    expect(view.selectedClipPreview.canPlay).toBe(false);
  });

  it("disables generation when selected clip has validation issues", () => {
    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: true,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "generate",
      label: "生成",
      disabled: true,
      disabledReason: "先修正片段",
    });
  });

  it("lets runtime generating state override durable pending state", () => {
    const runtimeState = upsertGenerationJob(
      emptyGenerationRuntimeState,
      generatingJob,
    );
    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.preview.generatedClipCount).toBe(0);
    expect(view.preview.generatingClipCount).toBe(1);
    expect(view.selectedClipControl).toMatchObject({
      action: "cancel",
      label: "取消",
      progress: 42,
      statusLabel: "生成中",
    });
  });

  it("exposes a display project with runtime generation state without mutating the durable project", () => {
    const before = JSON.stringify(demoProject);
    const runtimeState = upsertGenerationJob(
      emptyGenerationRuntimeState,
      generatingJob,
    );

    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(findClip(view.displayProject, "voice_001").generation.status).toBe(
      "asset_generating",
    );
    expect(view.displaySelectedClip?.generation.status).toBe(
      "asset_generating",
    );
    expect(findClip(demoProject, "voice_001").generation.status).toBe(
      "asset_pending",
    );
    expect(JSON.stringify(demoProject)).toBe(before);
  });

  it("shows queued runtime jobs as active generation", () => {
    const runtimeState = upsertGenerationJob(
      emptyGenerationRuntimeState,
      makeRuntimeJob("queued", { progress: 8 }),
    );
    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.preview.generatingClipCount).toBe(1);
    expect(view.selectedClipControl).toMatchObject({
      action: "cancel",
      label: "取消",
      disabled: false,
      progress: 8,
      statusLabel: "生成中",
      jobId: "job_1",
    });
  });

  it("shows canceling runtime jobs as disabled cancel controls", () => {
    const runtimeState = upsertGenerationJob(
      emptyGenerationRuntimeState,
      makeRuntimeJob("canceling", { progress: 88 }),
    );
    const view = getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.preview.generatingClipCount).toBe(1);
    expect(view.selectedClipControl).toMatchObject({
      action: "cancel",
      label: "取消",
      disabled: true,
      disabledReason: "正在取消",
      progress: 88,
      statusLabel: "取消中",
    });
  });

  it.each(["succeeded", "failed", "canceled"] as const)(
    "ignores terminal runtime %s jobs",
    (status) => {
      const runtimeState = upsertGenerationJob(
        emptyGenerationRuntimeState,
        makeRuntimeJob(status),
      );
      const view = getGenerationView({
        project: demoProject,
        selectedClip: findClip(demoProject, "voice_001"),
        runtimeState,
        selectedClipHasValidationIssues: false,
      });

      expect(view.preview.generatingClipCount).toBe(0);
      expect(view.selectedClipControl).toMatchObject({
        action: "generate",
        label: "生成",
        disabled: false,
        statusLabel: "待生成",
      });
      expect(view.selectedClipControl.jobId).toBeUndefined();
    },
  );

  it("does not mutate the original project when applying runtime jobs", () => {
    const before = JSON.stringify(demoProject);
    const runtimeState = upsertGenerationJob(
      emptyGenerationRuntimeState,
      makeRuntimeJob("generating"),
    );

    getGenerationView({
      project: demoProject,
      selectedClip: findClip(demoProject, "voice_001"),
      runtimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(findClip(demoProject, "voice_001").generation.status).toBe(
      "asset_pending",
    );
    expect(JSON.stringify(demoProject)).toBe(before);
  });

  it("shows regenerate and playable preview for generated clips", () => {
    const project = commitGenerationSuccess(demoProject, "voice_001", {
      assetId: "mock_voice_001_job_1",
      uri: "mock://asset/voice_001/job_1",
      duration: 7.5,
    });
    const view = getGenerationView({
      project,
      selectedClip: findClip(project, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "regenerate",
      label: "重生成",
      disabled: false,
      statusLabel: "可预览",
    });
    expect(view.selectedClipPreview).toEqual({
      canPlay: true,
      label: "播放片段",
      uri: "mock://asset/voice_001/job_1",
    });
  });

  it("does not enable selected clip preview for non-mock assets", () => {
    const project = commitGenerationSuccess(demoProject, "voice_001", {
      assetId: "real_voice_001_job_1",
      uri: "https://example.com/audio.wav",
      duration: 7.5,
    });
    const view = getGenerationView({
      project,
      selectedClip: findClip(project, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "regenerate",
      disabled: false,
    });
    expect(view.selectedClipPreview).toEqual({
      canPlay: false,
      label: "暂无音频",
      uri: "https://example.com/audio.wav",
    });
  });

  it("enables selected clip preview for durable local clip assets", () => {
    const project = commitGenerationSuccess(demoProject, "voice_001", {
      assetId: "voice_001_20260707T000000000Z_abcd1234",
      uri: "asset://clip/voice_001_20260707T000000000Z_abcd1234",
      duration: 7.5,
    });
    const view = getGenerationView({
      project,
      selectedClip: findClip(project, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipPreview).toEqual({
      canPlay: true,
      label: "播放片段",
      uri: "asset://clip/voice_001_20260707T000000000Z_abcd1234",
    });
  });

  it("enables selected clip preview for generated non-voice local clip assets", () => {
    const project = commitGenerationSuccess(demoProject, "sfx_blanket_001", {
      assetId: "sfx_blanket_001_20260707T000000000Z_abcd1234",
      uri: "asset://clip/sfx_blanket_001_20260707T000000000Z_abcd1234",
      duration: 3.4,
    });
    const view = getGenerationView({
      project,
      selectedClip: findClip(project, "sfx_blanket_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "regenerate",
      disabled: false,
    });
    expect(view.selectedClipPreview).toEqual({
      canPlay: true,
      label: "播放片段",
      uri: "asset://clip/sfx_blanket_001_20260707T000000000Z_abcd1234",
    });
  });

  it("shows retry for failed clips", () => {
    const project = commitGenerationFailure(demoProject, "voice_001", {
      reason: "generate",
      error: "Mock generation failed",
    });
    const view = getGenerationView({
      project,
      selectedClip: findClip(project, "voice_001"),
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.selectedClipControl).toMatchObject({
      action: "retry",
      label: "重试",
      statusLabel: "失败",
      error: "Mock generation failed",
    });
  });

  it("exposes project mix controls when clip assets are ready", () => {
    const project = generateAllClipAssets();
    const view = getGenerationView({
      project,
      selectedClip: undefined,
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.preview.slots[0]).toMatchObject({
      id: "project_mix",
      statusLabel: "可混音",
    });
    expect(view.projectMixControl).toMatchObject({
      action: "mix",
      label: "生成整段",
      disabled: false,
      statusLabel: "可混音",
      canPlay: false,
      playLabel: "试听",
      canDownload: false,
      downloadLabel: "WAV",
    });
  });

  it("enables full-project playback and download for exported local mixes", () => {
    const readyProject = generateAllClipAssets();
    const fingerprint = getProjectMixFingerprint(readyProject);
    const project = commitProjectMixSuccess(readyProject, {
      assetId: "asmr_demo_001_wav_20260710T000000000Z_abcd1234",
      uri: "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
      duration: readyProject.duration,
    });
    const view = getGenerationView({
      project,
      selectedClip: undefined,
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
      projectMixFingerprint: fingerprint,
    });

    expect(view.projectMixControl).toMatchObject({
      action: "remix",
      label: "重混",
      statusLabel: "可试听",
      canPlay: true,
      canDownload: true,
      uri: "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
    });
  });

  it("marks exported project mixes stale when the timeline fingerprint changes", () => {
    const readyProject = generateAllClipAssets();
    const fingerprint = getProjectMixFingerprint(readyProject);
    const mixedProject = commitProjectMixSuccess(readyProject, {
      assetId: "asmr_demo_001_wav_20260710T000000000Z_abcd1234",
      uri: "asset://mix/asmr_demo_001_wav_20260710T000000000Z_abcd1234",
      duration: readyProject.duration,
    });
    const staleProject = updateClip(mixedProject, "voice_001", (clip) => {
      clip.duration += 0.5;
    });
    const view = getGenerationView({
      project: staleProject,
      selectedClip: undefined,
      runtimeState: emptyGenerationRuntimeState,
      selectedClipHasValidationIssues: false,
      projectMixFingerprint: fingerprint,
    });

    expect(view.projectMixControl).toMatchObject({
      action: "remix",
      label: "重混",
      statusLabel: "需重混",
      canPlay: true,
      canDownload: true,
    });
  });

  it("uses active runtime project mix jobs for project mix controls", () => {
    const project = generateAllClipAssets();
    const runtimeState = upsertGenerationJob(
      emptyGenerationRuntimeState,
      projectMixJob,
    );
    const view = getGenerationView({
      project,
      selectedClip: undefined,
      runtimeState,
      selectedClipHasValidationIssues: false,
    });

    expect(view.preview.slots[0]).toMatchObject({
      id: "project_mix",
      statusLabel: "混音中",
    });
    expect(view.projectMixControl).toMatchObject({
      action: "cancel",
      label: "取消",
      disabled: false,
      statusLabel: "混音中",
      progress: 66,
      jobId: "mix_job_1",
    });
  });
});
