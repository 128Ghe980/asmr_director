import type { AsmrProject } from "./schema";
import {
  getBinauralLabel,
  getLanguageLabel,
  getLimiterLabel,
  getStatusLabel,
} from "./ui-copy";
import { formatSeconds } from "./view-model";

export type ProjectWorkspaceBadgeTone =
  | "neutral"
  | "accent"
  | "ok"
  | "warn";

export type ProjectWorkspaceBadge = {
  label: string;
  tone: ProjectWorkspaceBadgeTone;
};

export type ProjectWorkspaceValidationBadge = ProjectWorkspaceBadge & {
  issueCount: number;
};

export type ProjectWorkspaceIdentity = {
  title: string;
  sceneName: string;
  projectId: string;
  duration: string;
  language: string;
  status: string;
};

export type ProjectWorkspaceMetadataRow = {
  label: string;
  value: string;
};

export type ProjectWorkspaceSummaryInput = {
  project: AsmrProject;
  isDirty: boolean;
  restoreState: "demo" | "restored";
  validationIssueCount: number;
};

export type ProjectWorkspaceSummary = {
  identity: ProjectWorkspaceIdentity;
  localState: ProjectWorkspaceBadge;
  saveState: ProjectWorkspaceBadge;
  validation: ProjectWorkspaceValidationBadge;
  preview: ProjectWorkspaceBadge;
  metadataRows: ProjectWorkspaceMetadataRow[];
};

function getLocalStateBadge({
  isDirty,
  restoreState,
}: Pick<
  ProjectWorkspaceSummaryInput,
  "isDirty" | "restoreState"
>): ProjectWorkspaceBadge {
  if (isDirty) {
    return {
      label: "已编辑",
      tone: "accent",
    };
  }

  if (restoreState === "restored") {
    return {
      label: "已恢复",
      tone: "neutral",
    };
  }

  return {
    label: "示例",
    tone: "neutral",
  };
}

function getSaveStateBadge(
  restoreState: ProjectWorkspaceSummaryInput["restoreState"],
): ProjectWorkspaceBadge {
  if (restoreState === "restored") {
    return {
      label: "本地已保存",
      tone: "ok",
    };
  }

  return {
    label: "示例项目",
    tone: "neutral",
  };
}

function getValidationBadge(
  validationIssueCount: number,
): ProjectWorkspaceValidationBadge {
  if (validationIssueCount > 0) {
    return {
      label: `${validationIssueCount} 个问题`,
      issueCount: validationIssueCount,
      tone: "warn",
    };
  }

  return {
    label: "校验通过",
    issueCount: 0,
    tone: "ok",
  };
}

function getMixingSummary(project: AsmrProject): string {
  const { mixing } = project.timeline;

  return `${getBinauralLabel(mixing.binaural)} · ${
    mixing.target_lufs
  } LUFS · ${getLimiterLabel(mixing.master_limiter)}`;
}

export function getProjectWorkspaceSummary({
  project,
  isDirty,
  restoreState,
  validationIssueCount,
}: ProjectWorkspaceSummaryInput): ProjectWorkspaceSummary {
  const duration = formatSeconds(project.duration);
  const language = getLanguageLabel(project.language);
  const status = getStatusLabel(project.status);

  return {
    identity: {
      title: project.title,
      sceneName: project.scene.name,
      projectId: project.project_id,
      duration,
      language,
      status,
    },
    localState: getLocalStateBadge({ isDirty, restoreState }),
    saveState: getSaveStateBadge(restoreState),
    validation: getValidationBadge(validationIssueCount),
    preview: {
      label: "预览未生成",
      tone: "warn",
    },
    metadataRows: [
      { label: "场景", value: project.scene.name },
      { label: "时长", value: duration },
      { label: "语言", value: language },
      { label: "状态", value: status },
      { label: "项目 ID", value: project.project_id },
      { label: "混音", value: getMixingSummary(project) },
    ],
  };
}
