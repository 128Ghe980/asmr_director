import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generateLocalClip } from "./local-clip-generation";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16MonoWav } from "./procedural-audio";
import { listAudioCandidates } from "./local-candidate-store";
import { makeSemanticVoiceLongTextResultFixture, makeVoiceCandidateFixture } from "./voice-candidate-fixture";
import { generateVoxCpm2 } from "./voxcpm2-provider";
import { listVoiceGenerationRecordings, resolveVoiceGenerationRecording } from "./voice-generation-recordings";
import { flattenClips } from "./view-model";
import { generateVoiceLongText } from "./voice-longtext-generation";
import { getVoiceGenerationContext } from "./voice-generation-context";
import { getVoiceCandidateSourceFingerprint } from "./audio-candidate";

vi.mock("./voxcpm2-provider", () => ({ generateVoxCpm2: vi.fn() }));
vi.mock("./voice-longtext-generation", () => ({ generateVoiceLongText: vi.fn() }));
const voiceOptions = { provider: "voxcpm2" as const, voicePackId: "soft_zh", referenceMode: "with_reference_text" as const, generationMode: "clip" as const };
async function setup() {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "asmr-vox-clip-"));
  return getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: runtimeRoot });
}

describe("VoxCPM2 clip dispatch", () => {
  it("dispatches only the selected semantic clip while storing its exact forward context fingerprint", async () => {
    const config = await setup();
    const project = structuredClone(demoProject);
    const voices = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
    voices[1].semantic_unit = true;
    voices[1].text = "这是选中的目标。";
    const context = getVoiceGenerationContext(project, voices[1].id)!;
    const before = JSON.stringify(project);
    vi.mocked(generateVoiceLongText).mockResolvedValue({
      wav: writePcm16MonoWav(new Float32Array(48000), 48000), qualityWarnings: [],
      provenance: { ...makeVoiceCandidateFixture().provenance, generationMode: "long_text",
        longText: makeSemanticVoiceLongTextResultFixture(voices[1].text, context) },
    });
    const result = await generateLocalClip({ project, clipId: voices[1].id, config,
      voiceOptions: { ...voiceOptions, generationMode: "long_text" } });
    expect(generateVoiceLongText).toHaveBeenCalledOnce();
    expect(vi.mocked(generateVoiceLongText).mock.calls[0][0]).toMatchObject({ text: voices[1].text, clipId: voices[1].id, context });
    expect(result).toHaveProperty("candidate.sourceFingerprint", getVoiceCandidateSourceFingerprint(voices[1], context));
    expect(result).toHaveProperty("candidate.provenance.longText.groups.length", 1);
    expect(JSON.stringify(project)).toBe(before);
    expect(await listAudioCandidates({ config, projectId: project.project_id, clipId: voices[2].id })).toHaveLength(0);
  });

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

  it("keeps published clip originals accessible after a canceled request without adopting a candidate", async () => {
    const config = await setup();
    const controller = new AbortController();
    const wav = writePcm16MonoWav(new Float32Array(48000).fill(.05), 48000);
    vi.mocked(generateVoxCpm2).mockImplementation(async (input) => {
      await input.onRawOutput!(wav);
      controller.abort();
      return { wav, provenance: makeVoiceCandidateFixture().provenance, qualityWarnings: [] };
    });
    await expect(generateLocalClip({ project: demoProject, clipId: "voice_001", config, voiceOptions, signal: controller.signal })).rejects.toThrow();
    const clip = flattenClips(demoProject).find((item) => item.id === "voice_001")!;
    if (clip.type !== "voice") throw new Error("Fixture must be voice");
    const listed = await listVoiceGenerationRecordings({ config, projectId: demoProject.project_id, clipId: clip.id, text: clip.text });
    expect(listed.recordings).toHaveLength(1);
    const recording = await resolveVoiceGenerationRecording(config, listed.recordings[0].recordingId);
    expect((await readFile(recording.filePath)).equals(Buffer.from(wav))).toBe(true);
    expect(await listAudioCandidates({ config, projectId: demoProject.project_id, clipId: clip.id })).toHaveLength(0);
  });
});
