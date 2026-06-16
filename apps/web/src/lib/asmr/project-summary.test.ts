import { describe, expect, it } from "vitest";

import {
  getProjectValidationIssues,
  updateClipInProject,
} from "./edit-project";
import { demoProject } from "./mock-project";
import { getProjectWorkspaceSummary } from "./project-summary";
import {
  getBinauralLabel,
  getLanguageLabel,
  getLimiterLabel,
  getStatusLabel,
} from "./ui-copy";
import { formatSeconds } from "./view-model";

describe("project workspace summary", () => {
  it("summarizes a clean demo project for workspace display", () => {
    const summary = getProjectWorkspaceSummary({
      project: demoProject,
      isDirty: false,
      restoreState: "demo",
      validationIssueCount: 0,
    });

    expect(summary.identity).toEqual({
      title: demoProject.title,
      sceneName: demoProject.scene.name,
      projectId: demoProject.project_id,
      duration: formatSeconds(demoProject.duration),
      language: getLanguageLabel(demoProject.language),
      status: getStatusLabel(demoProject.status),
    });
    expect(summary.localState).toEqual({
      label: "示例",
      tone: "neutral",
    });
    expect(summary.saveState).toEqual({
      label: "示例项目",
      tone: "neutral",
    });
    expect(summary.validation).toEqual({
      label: "校验通过",
      issueCount: 0,
      tone: "ok",
    });
    expect(summary.preview).toEqual({
      label: "预览未生成",
      tone: "warn",
    });
    expect(summary.metadataRows).toEqual([
      { label: "场景", value: demoProject.scene.name },
      { label: "时长", value: formatSeconds(demoProject.duration) },
      { label: "语言", value: getLanguageLabel(demoProject.language) },
      { label: "状态", value: getStatusLabel(demoProject.status) },
      { label: "项目 ID", value: demoProject.project_id },
      {
        label: "混音",
        value: `${getBinauralLabel(
          demoProject.timeline.mixing.binaural,
        )} · ${demoProject.timeline.mixing.target_lufs} LUFS · ${getLimiterLabel(
          demoProject.timeline.mixing.master_limiter,
        )}`,
      },
    ]);
  });

  it("marks edited projects with an accent local state and locally saved save state", () => {
    const updated = updateClipInProject(demoProject, "voice_001", {
      volume_db: -10,
    });

    const summary = getProjectWorkspaceSummary({
      project: updated,
      isDirty: true,
      restoreState: "demo",
      validationIssueCount: 0,
    });

    expect(summary.localState).toEqual({
      label: "已编辑",
      tone: "accent",
    });
    expect(summary.saveState).toEqual({
      label: "本地已保存",
      tone: "ok",
    });
  });

  it("marks restored local projects as recovered and locally saved", () => {
    const summary = getProjectWorkspaceSummary({
      project: demoProject,
      isDirty: false,
      restoreState: "restored",
      validationIssueCount: 0,
    });

    expect(summary.localState).toEqual({
      label: "已恢复",
      tone: "neutral",
    });
    expect(summary.saveState).toEqual({
      label: "本地已保存",
      tone: "ok",
    });
  });

  it("surfaces validation failure counts with a warning tone", () => {
    const invalidProject = updateClipInProject(demoProject, "voice_004", {
      start: 208,
      duration: 12,
    });
    const validationIssueCount =
      getProjectValidationIssues(invalidProject).length;

    const summary = getProjectWorkspaceSummary({
      project: invalidProject,
      isDirty: true,
      restoreState: "restored",
      validationIssueCount,
    });

    expect(validationIssueCount).toBeGreaterThan(0);
    expect(summary.validation).toEqual({
      label: `${validationIssueCount} 个问题`,
      issueCount: validationIssueCount,
      tone: "warn",
    });
  });
});
