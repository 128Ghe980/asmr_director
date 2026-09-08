import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { commitGenerationSuccess } from "./generation-project-state";
import {
  resolveClipAssetPath,
  resolveMixAssetPath,
} from "./local-asset-store";
import { generateLocalProjectMix } from "./local-project-mix-generation";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { decodePcmWav, writePcm16StereoWav } from "./project-mix-renderer";
import type { AsmrProject, TimelineClip } from "./schema";
import { flattenClips } from "./view-model";

async function makeRuntimeConfig(): Promise<LocalRuntimeConfig> {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "asmr-runtime-"));

  return {
    runtimeRoot,
    gptSovitsBaseUrl: "http://127.0.0.1:9880",
    voicePackPath: path.join(runtimeRoot, "voice-pack.json"),
    clipAssetRoot: path.join(runtimeRoot, "assets", "clips", "app"),
    mixAssetRoot: path.join(runtimeRoot, "assets", "mixes", "app"),
  };
}

function findClip(project: AsmrProject, clipId: string): TimelineClip {
  const clip = flattenClips(project).find((candidate) => candidate.id === clipId);

  if (!clip) {
    throw new Error(`Missing clip ${clipId}`);
  }

  return clip;
}

function makeTracksWithSingleClip(
  clip: TimelineClip,
): AsmrProject["timeline"]["tracks"] {
  switch (clip.track) {
    case "voice":
      return [
        { track_type: "voice", clips: [clip] },
        { track_type: "breath", clips: [] },
        { track_type: "sfx", clips: [] },
        { track_type: "ambience", clips: [] },
        { track_type: "post_processing", clips: [] },
      ];
    case "breath":
      return [
        { track_type: "voice", clips: [] },
        { track_type: "breath", clips: [clip] },
        { track_type: "sfx", clips: [] },
        { track_type: "ambience", clips: [] },
        { track_type: "post_processing", clips: [] },
      ];
    case "sfx":
      return [
        { track_type: "voice", clips: [] },
        { track_type: "breath", clips: [] },
        { track_type: "sfx", clips: [clip] },
        { track_type: "ambience", clips: [] },
        { track_type: "post_processing", clips: [] },
      ];
    case "ambience":
      return [
        { track_type: "voice", clips: [] },
        { track_type: "breath", clips: [] },
        { track_type: "sfx", clips: [] },
        { track_type: "ambience", clips: [clip] },
        { track_type: "post_processing", clips: [] },
      ];
  }
}

function makeSingleClipProject({
  generated,
}: {
  generated: boolean;
}): AsmrProject {
  const sourceClip = findClip(demoProject, "voice_001");
  const clip: TimelineClip = {
    ...structuredClone(sourceClip),
    start: 0,
    duration: 1,
    volume_db: 0,
    fade_in: 0,
    fade_out: 0,
  };
  const project: AsmrProject = {
    ...structuredClone(demoProject),
    duration: 1,
    timeline: {
      ...structuredClone(demoProject.timeline),
      mixing: {
        target_lufs: -18,
        binaural: true,
        master_limiter: true,
      },
      tracks: makeTracksWithSingleClip(clip),
    },
  };

  return generated
    ? commitGenerationSuccess(project, "voice_001", {
        assetId: "voice_001_asset",
        uri: "asset://clip/voice_001_asset",
        duration: 1,
      })
    : project;
}

async function writeClipAsset(config: LocalRuntimeConfig, assetId: string, sampleRate: number) {
  const source = writePcm16StereoWav(new Float32Array(sampleRate * 2).fill(0.25), sampleRate);
  const assetPath = resolveClipAssetPath(assetId, config);

  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, source);
}

describe("local project mix generation", () => {
  it("fails with missing clip IDs when clip assets are not ready", async () => {
    const config = await makeRuntimeConfig();

    await expect(
      generateLocalProjectMix({
        project: makeSingleClipProject({ generated: false }),
        config,
      }),
    ).rejects.toThrow("voice_001");
  });

  it.each([32000, 44100, 48000])("reads a local %i Hz WAV and stores a durable 48 kHz mix", async (sampleRate) => {
    const config = await makeRuntimeConfig();
    const project = makeSingleClipProject({ generated: true });

    await writeClipAsset(config, "voice_001_asset", sampleRate);

    const asset = await generateLocalProjectMix({
      project,
      config,
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    const saved = await readFile(resolveMixAssetPath(asset.assetId, config));

    expect(asset.uri).toMatch(/^asset:\/\/mix\/asmr_demo_001_wav_/);
    expect(asset.duration).toBe(project.duration);
    expect(saved.subarray(0, 4).toString("ascii")).toBe("RIFF");
    const decoded = decodePcmWav(saved);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channels).toBe(2);
    expect(decoded.samples.length / 2 / decoded.sampleRate).toBe(project.duration);
  });
});
