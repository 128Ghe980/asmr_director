import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateLocalClip } from "./local-clip-generation";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16MonoWav } from "./procedural-audio";
import { listAudioCandidates } from "./local-candidate-store";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";
import { generateVoxCpm2 } from "./voxcpm2-provider";

vi.mock("./voxcpm2-provider", () => ({ generateVoxCpm2: vi.fn() }));
const voiceOptions = { provider: "voxcpm2" as const, voicePackId: "soft_zh", referenceMode: "with_reference_text" as const, generationMode: "clip" as const };
async function setup() {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "asmr-vox-clip-"));
  return getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: runtimeRoot });
}

describe("VoxCPM2 clip dispatch", () => {
  it("persists a candidate with measured WAV length without mutating the source project", async () => {
    const config = await setup();
    const original = JSON.stringify(demoProject);
    vi.mocked(generateVoxCpm2).mockResolvedValue({
      wav: new Uint8Array(writePcm16MonoWav(new Float32Array(48000 * 9), 48000)),
      provenance: makeVoiceCandidateFixture().provenance, qualityWarnings: [],
    });
    const result = await generateLocalClip({ project: demoProject, clipId: "voice_001", config, voiceOptions });
    expect(result).toHaveProperty("candidate.asset.duration", 9);
    expect(result).toHaveProperty("candidate.wav.sampleRate", 48000);
    expect(await listAudioCandidates({ config, projectId: demoProject.project_id, clipId: "voice_001" })).toHaveLength(1);
    expect(JSON.stringify(demoProject)).toBe(original);
  });

  it("does not save canceled output", async () => {
    const config = await setup();
    const controller = new AbortController();
    vi.mocked(generateVoxCpm2).mockImplementation(async () => {
      controller.abort();
      return { wav: new Uint8Array(writePcm16MonoWav(new Float32Array(48000), 48000)), provenance: makeVoiceCandidateFixture().provenance, qualityWarnings: [] };
    });
    await expect(generateLocalClip({ project: demoProject, clipId: "voice_001", config, voiceOptions, signal: controller.signal })).rejects.toThrow();
    expect(await listAudioCandidates({ config, projectId: demoProject.project_id, clipId: "voice_001" })).toHaveLength(0);
    await expect(readdir(config.clipAssetRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
