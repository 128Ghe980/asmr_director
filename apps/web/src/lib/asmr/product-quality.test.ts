import { describe, expect, it } from "vitest";

import type { AudioAnalysis } from "./audio-analysis";
import { demoProject } from "./mock-project";
import { getProductQualityReport } from "./product-quality";
import type { AsmrProject } from "./schema";

function makeGeneratedProject(): AsmrProject {
  return {
    ...demoProject,
    timeline: {
      ...demoProject.timeline,
      tracks: demoProject.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({
          ...clip,
          generation: { ...clip.generation, status: "asset_generated" },
          asset: {
            asset_id: `${clip.id}_asset`,
            uri: `asset://clip/${clip.id}_asset`,
            duration: clip.duration,
          },
        })),
      })) as AsmrProject["timeline"]["tracks"],
    },
    exports: [
      ...demoProject.exports,
      {
        type: "wav",
        status: "exported",
        uri: "asset://mix/demo_mix",
      },
    ],
  };
}

const healthyAnalysis: AudioAnalysis = {
  bars: [20, 60, 100, 40],
  duration: 210,
  sampleRate: 32000,
  channels: 2,
  peakDbfs: -1.2,
  rmsDbfs: -18,
  clippedSampleCount: 0,
};

function checkTone(
  report: ReturnType<typeof getProductQualityReport>,
  id: string,
) {
  return report.checks.find((check) => check.id === id)?.tone;
}

describe("product quality report", () => {
  it("blocks schema issues, missing assets, and a missing mix", () => {
    const report = getProductQualityReport({
      project: demoProject,
      validationIssueCount: 2,
      mixIsStale: false,
      analysisStatus: "idle",
    });

    expect(checkTone(report, "schema")).toBe("block");
    expect(checkTone(report, "assets")).toBe("block");
    expect(checkTone(report, "mix")).toBe("block");
    expect(report.blockerCount).toBeGreaterThanOrEqual(3);
    expect(report.overallTone).toBe("block");
  });

  it("blocks a stale mix even when all assets exist", () => {
    const report = getProductQualityReport({
      project: makeGeneratedProject(),
      validationIssueCount: 0,
      mixIsStale: true,
      analysisStatus: "ready",
      analysis: healthyAnalysis,
    });

    expect(checkTone(report, "assets")).toBe("pass");
    expect(checkTone(report, "mix")).toBe("block");
  });

  it("passes a current stereo mix with healthy headroom", () => {
    const report = getProductQualityReport({
      project: makeGeneratedProject(),
      validationIssueCount: 0,
      mixIsStale: false,
      analysisStatus: "ready",
      analysis: healthyAnalysis,
    });

    expect(report.overallTone).toBe("pass");
    expect(report.blockerCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(checkTone(report, "analysis")).toBe("pass");
    expect(checkTone(report, "channels")).toBe("pass");
    expect(checkTone(report, "headroom")).toBe("pass");
  });

  it("warns for mono audio and unavailable analysis", () => {
    const project = makeGeneratedProject();
    const mono = getProductQualityReport({
      project,
      validationIssueCount: 0,
      mixIsStale: false,
      analysisStatus: "ready",
      analysis: { ...healthyAnalysis, channels: 1 },
    });
    const unavailable = getProductQualityReport({
      project,
      validationIssueCount: 0,
      mixIsStale: false,
      analysisStatus: "error",
    });

    expect(checkTone(mono, "channels")).toBe("warn");
    expect(checkTone(unavailable, "analysis")).toBe("warn");
  });

  it("warns near zero headroom and blocks actual clipping", () => {
    const project = makeGeneratedProject();
    const nearZero = getProductQualityReport({
      project,
      validationIssueCount: 0,
      mixIsStale: false,
      analysisStatus: "ready",
      analysis: { ...healthyAnalysis, peakDbfs: -0.2 },
    });
    const clipped = getProductQualityReport({
      project,
      validationIssueCount: 0,
      mixIsStale: false,
      analysisStatus: "ready",
      analysis: {
        ...healthyAnalysis,
        peakDbfs: 0,
        clippedSampleCount: 8,
      },
    });

    expect(checkTone(nearZero, "headroom")).toBe("warn");
    expect(checkTone(clipped, "headroom")).toBe("block");
    expect(clipped.overallTone).toBe("block");
  });
});

