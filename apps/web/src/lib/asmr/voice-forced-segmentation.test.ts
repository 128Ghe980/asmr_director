import { describe, expect, it } from "vitest";
import { AudioCandidateSchema } from "./audio-candidate";
import { makeVoiceCandidateFixture, makeVoiceLongTextResultFixture } from "./voice-candidate-fixture";
import { ForcedSegmentationSchema } from "./voice-forced-segmentation";

function forcedCandidate() {
  const candidate = makeVoiceCandidateFixture(), longText = makeVoiceLongTextResultFixture(), group = longText.groups[0];
  const sourceAssetId = group.asset.assetId;
  group.asset = { assetId: "forced_group", uri: "asset://clip/forced_group", duration: 1 };
  group.cutEndSeconds = 1; group.checkStatus = "passed"; group.segmentationMethod = "ctc_forced";
  group.internalPausesMs = []; group.internalPauseClasses = []; group.internalPausePositions = [];
  group.recognition = { analysisMode: "cutting_only", stage: "boundary_check", sourceTranscript: "原始失败识别", expectedText: group.text };
  return AudioCandidateSchema.parse({ ...candidate, candidateId: "forced_candidate",
    provenance: { ...candidate.provenance, generationMode: "long_text", longText,
      forcedSegmentation: { version: 1, method: "ctc_forced", sourceCandidateId: candidate.candidateId,
        createdAt: "2026-10-21T00:00:00.000Z", contentVerified: false,
        alignments: [{ method: "ctc_forced", mode: "prefix", groupIndex: 0, sourceAssetId,
          sourceSha256: "a".repeat(64), inputTextSha256: "b".repeat(64), sampleRate: 48_000, sourceFrames: 144_000,
          cutFrames: [48_000], modelId: "existing-local-model", modelRevision: "pinned-revision", contentVerified: false,
          characters: [{ char: "字", startSeconds: .2, endSeconds: .3, score: 1e-15 }] }] } } });
}
describe("persisted forced segmentation receipts", () => {
  it("leaves old candidates readable and retains historical ASR without reinterpreting its failed stage", () => {
    expect(AudioCandidateSchema.parse(makeVoiceCandidateFixture())).toEqual(makeVoiceCandidateFixture());
    const candidate = forcedCandidate();
    expect(candidate.provenance.longText!.groups[0].recognition?.stage).toBe("boundary_check");
    expect(candidate.provenance.forcedSegmentation?.contentVerified).toBe(false);
  });
  it.each(["missing_receipt", "wrong_group", "wrong_endpoint", "self_source", "fake_approval", "duplicate_boundary"])(
    "rejects unbound or forged result %s", kind => {
      const candidate = forcedCandidate(), receipt = candidate.provenance.forcedSegmentation!, alignment = receipt.alignments[0];
      if (kind === "missing_receipt") delete candidate.provenance.forcedSegmentation;
      if (kind === "wrong_group") alignment.groupIndex = 1;
      if (kind === "wrong_endpoint") alignment.cutFrames = [60_000];
      if (kind === "self_source") receipt.sourceCandidateId = candidate.candidateId;
      if (kind === "fake_approval") Object.assign(receipt, { contentVerified: true });
      if (kind === "duplicate_boundary") alignment.cutFrames = [48_000, 48_000];
      expect(AudioCandidateSchema.safeParse(candidate).success).toBe(false);
    });
  it("records complete retention without inventing a CTC model or characters", () => {
    const receipt = { version: 1, method: "ctc_forced", sourceCandidateId: "old_candidate",
      createdAt: "2026-10-21T00:00:00.000Z", contentVerified: false,
      alignments: [{ method: "whole_recording", groupIndex: 1, sourceAssetId: "original",
        sourceSha256: "a".repeat(64), inputTextSha256: "b".repeat(64), sampleRate: 48_000, sourceFrames: 48_000,
        cutFrames: [], contentVerified: false }] };
    expect(ForcedSegmentationSchema.parse(receipt)).toEqual(receipt);
    expect(ForcedSegmentationSchema.safeParse({ ...receipt, alignments: [{ ...receipt.alignments[0], modelId: "invented" }] }).success).toBe(false);
  });
  it("preserves an unsupported original character when its alignment uses an explicit wildcard state", () => {
    const candidate = forcedCandidate(), alignment = candidate.provenance.forcedSegmentation!.alignments[0];
    if (alignment.method !== "ctc_forced") throw new Error("Expected CTC fixture");
    alignment.characters[0].wildcard = true;
    expect(AudioCandidateSchema.parse(candidate).provenance.forcedSegmentation!.alignments[0]).toMatchObject({
      characters: [{ char: "字", wildcard: true }] });
    Object.assign(alignment.characters[0], { wildcard: false });
    expect(AudioCandidateSchema.safeParse(candidate).success).toBe(false);
  });
});
