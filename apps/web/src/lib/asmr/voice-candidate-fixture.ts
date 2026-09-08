import { getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { demoProject } from "./mock-project";
import { flattenClips } from "./view-model";

// Shared deterministic input for bridge and workspace interaction tests.
export function makeVoiceCandidateFixture(overrides: Partial<AudioCandidate> = {}): AudioCandidate {
  const voice = flattenClips(demoProject).find((item) => item.id === "voice_001")!;
  return {
    version: 1,
    candidateId: "candidate_fixture_1",
    projectId: "asmr_demo_001",
    clipId: "voice_001",
    sourceFingerprint: getVoiceCandidateSourceFingerprint(voice),
    requestFingerprint: getVoiceCandidateRequestFingerprint(voice, { provider: "voxcpm2", voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip" }),
    asset: { assetId: "voice_fixture_1", uri: "asset://clip/voice_fixture_1", duration: 8.5 },
    wav: { sampleRate: 48000, channels: 1, bitsPerSample: 16 },
    provenance: {
      provider: "voxcpm2", model: "VoxCPM2", seed: 1234, temperature: 1,
      voicePackId: "soft_zh", referenceMode: "with_reference_text", generationMode: "clip",
      parameters: { cfg: 2, timesteps: 10, gpuLayers: 0, lowVram: true },
    },
    qualityWarnings: [],
    createdAt: "2026-09-08T00:00:00.000Z",
    status: "ready",
    ...overrides,
  };
}
