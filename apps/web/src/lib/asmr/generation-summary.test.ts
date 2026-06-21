import { describe, expect, it } from "vitest";

import {
  getAssetStatusDisplay,
  getProjectPreviewSummary,
} from "./generation-summary";
import { demoProject } from "./mock-project";
import type { AsmrProject, AssetStatus, TimelineClip } from "./schema";

function cloneProject(): AsmrProject {
  return structuredClone(demoProject);
}

function findClip(project: AsmrProject, clipId: string): TimelineClip {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);

    if (clip) {
      return clip;
    }
  }

  throw new Error(`Missing clip ${clipId}`);
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

function setClipStatus(
  project: AsmrProject,
  clipId: string,
  status: AssetStatus,
): AsmrProject {
  return updateClip(project, clipId, (clip) => {
    clip.generation.status = status;
  });
}

describe("generation summary", () => {
  it("maps asset statuses to display labels and tones", () => {
    expect(getAssetStatusDisplay("asset_pending")).toEqual({
      statusLabel: "待生成",
      tone: "neutral",
    });
    expect(getAssetStatusDisplay("asset_generating")).toEqual({
      statusLabel: "队列中",
      tone: "accent",
    });
    expect(getAssetStatusDisplay("asset_generated")).toEqual({
      statusLabel: "可预览",
      tone: "ok",
    });
    expect(getAssetStatusDisplay("asset_failed")).toEqual({
      statusLabel: "失败",
      tone: "warn",
    });
  });

  it("summarizes the pending demo project preview slots", () => {
    const summary = getProjectPreviewSummary({ project: demoProject });

    expect(summary.previewTitle).toBe("项目预览");
    expect(summary.statusLabel).toBe("等待素材槽完成");
    expect(summary.statusTone).toBe("neutral");
    expect(summary.realAudioCount).toBe(0);
    expect(summary.totalClipCount).toBe(9);
    expect(summary.pendingClipCount).toBe(9);
    expect(summary.generatedClipCount).toBe(0);
    expect(summary.generatingClipCount).toBe(0);
    expect(summary.failedClipCount).toBe(0);
    expect(summary.waveformBars).toEqual([
      28, 44, 36, 62, 48, 76, 42, 58, 34, 66, 46, 30,
    ]);
    expect(summary.slots).toEqual([
      {
        id: "project_mix",
        label: "项目混音",
        detail: "9 个片段 · 03:30",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 9,
      },
      {
        id: "voice",
        label: "人声轨",
        detail: "4 个片段",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 4,
      },
      {
        id: "breath",
        label: "呼吸轨",
        detail: "2 个片段",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 2,
      },
      {
        id: "sfx",
        label: "音效轨",
        detail: "2 个片段",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 2,
      },
      {
        id: "ambience",
        label: "环境轨",
        detail: "1 个片段",
        statusLabel: "待生成",
        tone: "neutral",
        clipCount: 1,
      },
    ]);
    expect(summary.selectedClipSlot).toBeUndefined();
  });

  it("counts mixed generation states and exposes a generated selected clip", () => {
    let project = cloneProject();
    project = setClipStatus(project, "voice_001", "asset_generated");
    project = setClipStatus(project, "voice_002", "asset_generated");
    project = setClipStatus(project, "breath_001", "asset_generating");
    project = setClipStatus(project, "sfx_cloth_001", "asset_failed");
    project = updateClip(project, "voice_001", (clip) => {
      clip.asset.asset_id = "asset_voice_001";
      clip.asset.duration = 7.5;
    });
    project = updateClip(project, "voice_002", (clip) => {
      clip.asset.uri = "file:///tmp/voice_002.wav";
      clip.asset.duration = 8.2;
    });

    const summary = getProjectPreviewSummary({
      project,
      selectedClip: findClip(project, "voice_001"),
    });

    expect(summary.statusLabel).toBe("等待素材槽完成");
    expect(summary.statusTone).toBe("warn");
    expect(summary.realAudioCount).toBe(2);
    expect(summary.totalClipCount).toBe(9);
    expect(summary.pendingClipCount).toBe(5);
    expect(summary.generatedClipCount).toBe(2);
    expect(summary.generatingClipCount).toBe(1);
    expect(summary.failedClipCount).toBe(1);
    expect(summary.selectedClipSlot).toEqual({
      id: "selected_clip",
      label: "当前片段",
      detail: "人声 · 00:16-00:23",
      statusLabel: "可预览",
      tone: "ok",
      clipCount: 1,
    });
  });

  it("shows a pending selected sfx clip without mutating project JSON", () => {
    const project = cloneProject();
    const beforeJson = JSON.stringify(project);

    const summary = getProjectPreviewSummary({
      project,
      selectedClip: findClip(project, "sfx_blanket_001"),
    });

    expect(summary.selectedClipSlot).toEqual({
      id: "selected_clip",
      label: "当前片段",
      detail: "音效 · 00:42-00:45",
      statusLabel: "待生成",
      tone: "neutral",
      clipCount: 1,
    });
    expect(JSON.stringify(project)).toBe(beforeJson);
  });
});
