import { getVoiceCandidateRequestFingerprint, getVoiceCandidateSourceFingerprint, type AudioCandidate } from "./audio-candidate";
import { demoProject } from "./mock-project";
import { flattenClips } from "./view-model";
import { buildLongTextInputs, createSemanticVoiceLongTextPlan, type VoiceLongTextPlan } from "./voice-longtext-plan";
import type { VoiceLongTextResult } from "./voice-longtext-result";
import type { VoiceGenerationContext } from "./voice-generation-context";

export function makeSemanticVoiceLongTextResultFixture(text: string, context: VoiceGenerationContext): VoiceLongTextResult {
  const plan = createSemanticVoiceLongTextPlan(text, context);
  const input = buildLongTextInputs(plan, context)[0];
  const base = makeVoiceLongTextResultFixture();
  return {
    ...base, context, plan, analysisProvider: plan.provider,
    groups: [{ ...base.groups[0], text: input.expectedText, inputText: input.text, paddingClauses: input.paddingClauses,
      isFinal: input.isFinal, pauseAfter: plan.groups[0].pauseAfter,
      internalPauseClasses: plan.clausePauseClasses, internalPausesMs: plan.clausePauseClasses.map(() => 180) }],
    joins: [],
  };
}

export function makeVoiceLongTextResultFixture(): VoiceLongTextResult {
  const clauses = ["放松肩膀，", "慢慢呼吸。", "夜已经深了，", "安心休息。"];
  const plan: VoiceLongTextPlan = {
    clauses,
    groups: [{ start: 0, end: 1, text: clauses.slice(0, 2).join(""), pauseAfter: "medium" },
      { start: 2, end: 3, text: clauses.slice(2).join(""), pauseAfter: "long" }],
    clausePauseClasses: ["short", "medium", "short"], provider: "rules", warnings: [],
  };
  const inputs = buildLongTextInputs(plan);
  return {
    version: 1, analysisProvider: "rules", plan, loudnessGainDb: 0, asrModel: "fixture-asr",
    groups: inputs.map((input, index) => ({
      index, text: input.expectedText, inputText: input.text, paddingClauses: input.paddingClauses,
      isFinal: input.isFinal, pauseAfter: plan.groups[index].pauseAfter,
      seed: 100 + index, parameters: {},
      asset: { assetId: `fixture_group_${index}`, uri: `asset://clip/fixture_group_${index}`, duration: 2 },
      internalPausesMs: [180], internalPauseClasses: ["short"], leadingQuietMs: 10, trailingQuietMs: 10,
      transcript: input.expectedText, coverage: 1, cutStartSeconds: 0, cutEndSeconds: 2, attempts: 1,
    })),
    joins: [{ durationMs: 350, actualDurationMs: 350, source: "default", category: "medium" }],
  };
}

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
