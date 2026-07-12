import type { AudioAnalysis } from "./audio-analysis";
import {
  getMissingProjectMixClipIds,
  getWavExport,
} from "./project-mix-state";
import type { AsmrProject } from "./schema";

export type ProductQualityTone = "pass" | "warn" | "block";
export type AudioAnalysisStatus = "idle" | "loading" | "ready" | "error";

export type ProductQualityCheck = {
  id: "schema" | "assets" | "mix" | "analysis" | "channels" | "headroom";
  label: string;
  detail: string;
  tone: ProductQualityTone;
};

export type ProductQualityReport = {
  checks: ProductQualityCheck[];
  passCount: number;
  warningCount: number;
  blockerCount: number;
  overallTone: ProductQualityTone;
};

export type ProductQualityInput = {
  project: AsmrProject;
  validationIssueCount: number;
  mixIsStale: boolean;
  analysisStatus: AudioAnalysisStatus;
  analysis?: AudioAnalysis;
};

function formatDbfs(value: number | null): string {
  return value === null ? "静音" : `${value.toFixed(1)} dBFS`;
}
export function getProductQualityReport({
  project,
  validationIssueCount,
  mixIsStale,
  analysisStatus,
  analysis,
}: ProductQualityInput): ProductQualityReport {
  const missingAssetIds = getMissingProjectMixClipIds(project);
  const wavExport = getWavExport(project);
  const hasLocalMix =
    wavExport?.status === "exported" &&
    Boolean(wavExport.uri?.startsWith("asset://mix/"));
  const checks: ProductQualityCheck[] = [
    validationIssueCount > 0
      ? {
          id: "schema",
          label: "项目校验",
          detail: `${validationIssueCount} 个问题待修复`,
          tone: "block",
        }
      : {
          id: "schema",
          label: "项目校验",
          detail: "结构有效",
          tone: "pass",
        },
    missingAssetIds.length > 0
      ? {
          id: "assets",
          label: "音频素材",
          detail: `还缺 ${missingAssetIds.length} 个片段`,
          tone: "block",
        }
      : {
          id: "assets",
          label: "音频素材",
          detail: "片段齐全",
          tone: "pass",
        },
    !hasLocalMix
      ? {
          id: "mix",
          label: "整段混音",
          detail: "尚未生成",
          tone: "block",
        }
      : mixIsStale
        ? {
            id: "mix",
            label: "整段混音",
            detail: "项目已修改，需重混",
            tone: "block",
          }
        : {
            id: "mix",
            label: "整段混音",
            detail: "当前版本可用",
            tone: "pass",
          },
  ];

  if (analysisStatus === "ready" && analysis) {
    checks.push({
      id: "analysis",
      label: "音频分析",
      detail: `${(analysis.sampleRate / 1000).toFixed(1)} kHz · ${analysis.duration.toFixed(1)} 秒`,
      tone: "pass",
    });
    checks.push(
      analysis.channels === 2
        ? {
            id: "channels",
            label: "声道",
            detail: "双声道",
            tone: "pass",
          }
        : {
            id: "channels",
            label: "声道",
            detail: "单声道，空间感有限",
            tone: "warn",
          },
    );

    if (analysis.clippedSampleCount > 0) {
      checks.push({
        id: "headroom",
        label: "峰值余量",
        detail: `${analysis.clippedSampleCount} 个采样削波`,
        tone: "block",
      });
    } else if (analysis.peakDbfs === null) {
      checks.push({
        id: "headroom",
        label: "峰值余量",
        detail: "音频为静音",
        tone: "warn",
      });
    } else if (analysis.peakDbfs > -0.5) {
      checks.push({
        id: "headroom",
        label: "峰值余量",
        detail: `${formatDbfs(analysis.peakDbfs)}，余量偏小`,
        tone: "warn",
      });
    } else {
      checks.push({
        id: "headroom",
        label: "峰值余量",
        detail: `${formatDbfs(analysis.peakDbfs)} · RMS ${formatDbfs(analysis.rmsDbfs)}`,
        tone: "pass",
      });
    }
  } else {
    const detail =
      analysisStatus === "loading"
        ? "正在读取真实 WAV"
        : analysisStatus === "error"
          ? "真实 WAV 暂时无法分析"
          : "生成整段后检查";

    checks.push({
      id: "analysis",
      label: "音频分析",
      detail,
      tone: "warn",
    });
    checks.push({
      id: "channels",
      label: "声道",
      detail: "等待音频分析",
      tone: "warn",
    });
    checks.push({
      id: "headroom",
      label: "峰值余量",
      detail: "等待音频分析",
      tone: "warn",
    });
  }

  const passCount = checks.filter((check) => check.tone === "pass").length;
  const warningCount = checks.filter((check) => check.tone === "warn").length;
  const blockerCount = checks.filter((check) => check.tone === "block").length;

  return {
    checks,
    passCount,
    warningCount,
    blockerCount,
    overallTone:
      blockerCount > 0 ? "block" : warningCount > 0 ? "warn" : "pass",
  };
}
