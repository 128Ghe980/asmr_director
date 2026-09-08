import { describe, expect, it } from "vitest";
import { demoProject } from "./mock-project";
import {
  AudioCandidateSchema,
  getVoiceCandidateRequestFingerprint,
  getVoiceCandidateSourceFingerprint,
} from "./audio-candidate";
import { VoiceGenerationOptionsSchema } from "./voice-generation-options";

const voice = demoProject.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
const options = { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "reference_only", generationMode: "clip" } as const;

describe("voice candidate contracts", () => {
  it("rejects client runtime paths and unsupported modes", () => {
    expect(VoiceGenerationOptionsSchema.safeParse(options).success).toBe(true);
    expect(VoiceGenerationOptionsSchema.safeParse({ ...options, voicePackId: "../secret" }).success).toBe(false);
    expect(VoiceGenerationOptionsSchema.safeParse({ ...options, executablePath: "C:/cli.exe" }).success).toBe(false);
    expect(VoiceGenerationOptionsSchema.safeParse({ ...options, generationMode: "long_text" }).success).toBe(false);
  });

  it("keeps alternatives compatible after adoption or timeline shifts but rejects changed content", () => {
    const source = getVoiceCandidateSourceFingerprint(voice);
    expect(getVoiceCandidateSourceFingerprint({ ...voice, start: 99, duration: 12, generation: { ...voice.generation, model: "VoxCPM2", seed: 3 }, asset: { asset_id: "a", uri: "asset://clip/a", duration: 12 } })).toBe(source);
    expect(getVoiceCandidateSourceFingerprint({ ...voice, text: "另外一句话。" })).not.toBe(source);
    expect(getVoiceCandidateSourceFingerprint({ ...voice, style: "normal" })).not.toBe(source);
    expect(getVoiceCandidateRequestFingerprint(voice, options)).not.toBe(getVoiceCandidateRequestFingerprint(voice, { ...options, voicePackId: "normal_zh" }));
    expect(getVoiceCandidateRequestFingerprint(voice, options)).not.toBe(getVoiceCandidateRequestFingerprint({ ...voice, generation: { ...voice.generation, seed: 22 } }, options));
  });

  it("rejects legacy or mismatched stable asset references", () => {
    const candidate = {
      version: 1, candidateId: "candidate_1", projectId: demoProject.project_id, clipId: voice.id,
      sourceFingerprint: getVoiceCandidateSourceFingerprint(voice), requestFingerprint: getVoiceCandidateRequestFingerprint(voice, options),
      asset: { assetId: "voice_1", uri: "asset://clip/voice_1", duration: 8 },
      wav: { sampleRate: 48000, channels: 1, bitsPerSample: 16 },
      provenance: { ...options, model: "VoxCPM2", seed: 12, temperature: 1, parameters: { lowVram: true } },
      qualityWarnings: [], createdAt: "2026-09-08T00:00:00.000Z", status: "ready",
    };
    expect(AudioCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(AudioCandidateSchema.safeParse({ ...candidate, asset: { ...candidate.asset, uri: "asset://candidate/voice_1" } }).success).toBe(false);
    expect(AudioCandidateSchema.safeParse({ ...candidate, asset: { ...candidate.asset, assetId: "another" } }).success).toBe(false);
    expect(AudioCandidateSchema.safeParse({ ...candidate, version: 0 }).success).toBe(false);
  });
});
