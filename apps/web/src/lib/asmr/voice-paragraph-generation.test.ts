import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { listAudioCandidates } from "./local-candidate-store";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";
import { VoiceGroupAnalysisError, type analyzeVoiceGroup, type VoiceGroupAnalysis } from "./voice-group-analysis";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { generateVoiceParagraphCandidates } from "./voice-paragraph-generation";
import { paragraphPcmFrames, sliceParagraphPcmWav } from "./voice-paragraph-split";
import { listVoiceGenerationRecordings, resolveVoiceGenerationRecording } from "./voice-generation-recordings";
import { resolveClipAssetPath } from "./local-asset-store";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";

const voiceOptions = { provider: "voxcpm2" as const, voicePackId: "soft_zh", referenceMode: "with_reference_text" as const, generationMode: "paragraph" as const };
function cuttingAnalysis(input: Parameters<typeof analyzeVoiceGroup>[0], recognized = input.expectedText, similarity = 1): VoiceGroupAnalysis {
  const { frames } = paragraphPcmFrames(input.wav);
  const following = Boolean(input.followingText);
  const sourceWords = [{ text: recognized, start: .2, end: .72 },
    ...(following ? [{ text: input.followingText!, start: 1.28, end: 1.7 }] : [])];
  const cutEndSeconds = following ? 1 : frames / 48_000;
  return { wav: sliceParagraphPcmWav(input.wav, 0, Math.round(cutEndSeconds * 48_000)),
    transcript: recognized, coverage: similarity, internalPausesMs: [], leadingQuietMs: 0, trailingQuietMs: 0,
    cutStartSeconds: 0, cutEndSeconds, asrModel: "faster-whisper-large-v3/cpu/int8",
    boundaryOnly: { method: following ? "ordered_word_boundary" : "whole_recording", alignmentSimilarity: similarity,
      targetEndWordIndex: 0, ...(following ? { followingStartWordIndex: 1 } : {}), contentVerified: false, internalPausePositions: [] },
    recognition: { stage: "complete", analysisMode: "cutting_only", expectedText: input.expectedText,
      followingText: input.followingText ?? "", sourceTranscript: recognized + (input.followingText ?? ""),
      sourceWords, targetTranscript: recognized },
    ...(following ? { cutValidation: { method: "two_sided", thresholdDbfs: -66.02, quietStartSeconds: .8, quietEndSeconds: 1.2 } } : {}) };
}
async function fixture() {
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: await mkdtemp(path.join(os.tmpdir(), "asmr-paragraph-")) });
  const initial = structuredClone(demoProject);
  const initialClips = initial.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  initialClips[0].text = "先坐下吧。"; initialClips[1].text = "我替你倒杯茶。";
  const project = switchSpeechWorkspace(ensureSpeechWorkspaces(initial), "paragraph");
  const clips = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  project.speechWorkspace!.groups = [{ id: "paragraph-a", clipIds: clips.slice(0, 2).map((clip) => clip.id) },
    ...clips.slice(2).map((clip) => ({ id: `paragraph-${clip.id}`, clipIds: [clip.id] }))];
  const samples = new Float32Array(96_000);
  samples.fill(.05, 9600, 33_600); samples.fill(-.03, 57_600, 81_600);
  const wav = writePcm16Wav(samples, 48_000);
  const generate = vi.fn(async () => ({ wav, provenance: makeVoiceCandidateFixture().provenance, qualityWarnings: [] as string[] }));
  const analyze = vi.fn<typeof analyzeVoiceGroup>(async (input) => cuttingAnalysis(input));
  return { config, project, clips, wav, generate, analyze };
}

describe("direct paragraph candidate generation", () => {
  it("publishes every safely cut sibling despite ASR omitting a particle, without manufacturing manual confirmation", async () => {
    const f = await fixture(); f.clips[0].text = "回来啦。";
    f.analyze.mockImplementation(async input => input.followingText ? cuttingAnalysis(input, "回来", 2 / 3) : cuttingAnalysis(input));
    const { candidate } = await generateVoiceParagraphCandidates({ ...f, clipId: f.clips[1].id, voiceOptions }, { generate: f.generate, analyze: f.analyze });
    expect(candidate.provenance.paragraph).toMatchObject({ checkStatus: "passed", segments: [
      { recognition: { analysisMode: "cutting_only", targetTranscript: "回来" } }, { clipId: f.clips[1].id }] });
    expect(candidate.provenance.paragraph!.segments.every(segment => !segment.textReview)).toBe(true);
    expect(candidate.provenance.paragraph!.manualTextConfirmation).toBeUndefined();
    expect(candidate.asset).toEqual(candidate.provenance.paragraph!.segments[1].asset);
    expect(await listAudioCandidates({ config: f.config, projectId: f.project.project_id, workspaceMode: "paragraph" })).toHaveLength(2);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.analyze).toHaveBeenCalledTimes(2);
  });
  it("calls TTS exactly once with original full paragraph and saves shared verified cuts for every member", async () => {
    const f = await fixture();
    const before = JSON.stringify(f.project);
    const result = await generateVoiceParagraphCandidates({ ...f, clipId: f.clips[1].id, voiceOptions }, { generate: f.generate, analyze: f.analyze });
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.generate.mock.calls[0]).toMatchObject([{ text: "先坐下吧。我替你倒杯茶。", referenceMode: "with_reference_text" }, { paragraphMode: true, maxSteps: 800 }]);
    expect(result.candidate).toMatchObject({ clipId: f.clips[1].id, asset: { duration: 1 }, provenance: { generationMode: "paragraph", paragraph: { checkStatus: "passed", clipIds: [f.clips[0].id, f.clips[1].id], sourceAsset: { duration: 2 } }, parameters: { generationCalls: 1, normalization: "none", padding: "none", automaticQualityRetries: 0 } } });
    const candidates = await listAudioCandidates({ config: f.config, projectId: f.project.project_id });
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.provenance.paragraph)).toEqual([result.candidate.provenance.paragraph, result.candidate.provenance.paragraph]);
    const context = getVoiceParagraphContext(f.project, f.clips[1].id);
    expect(result.candidate.sourceFingerprint).toBe(getVoiceCandidateSourceFingerprint(f.clips[1], undefined, context));
    const payloads = await Promise.all(result.candidate.provenance.paragraph!.segments.map(async (segment) => paragraphPcmFrames(new Uint8Array(await readFile(resolveClipAssetPath(segment.asset.assetId, f.config)))).pcm));
    expect(Buffer.concat(payloads)).toEqual(Buffer.from(paragraphPcmFrames(f.wav).pcm));
    expect(JSON.stringify(f.project)).toBe(before);
  });
  it("still locates safe cuts when native generation reaches its step budget, retaining the native warning", async () => {
    const f = await fixture();
    const provenance = makeVoiceCandidateFixture().provenance;
    f.generate.mockResolvedValue({ wav: f.wav,
      provenance: { ...provenance, parameters: { ...provenance.parameters, maxSteps: 800, generatedSteps: 800 } },
      qualityWarnings: ["录音达到模型长度上限，可能没有读完。完整原音已保留，请试听后决定是否重新生成。"] });
    const { candidate } = await generateVoiceParagraphCandidates({ ...f, clipId: f.clips[1].id, voiceOptions },
      { generate: f.generate, analyze: f.analyze });
    expect(candidate.provenance.paragraph?.checkStatus).toBe("passed");
    expect(candidate.provenance.parameters).toMatchObject({ maxSteps: 800, generatedSteps: 800, generationCalls: 1 });
    expect(candidate.qualityWarnings).toEqual(["录音达到模型长度上限，可能没有读完。完整原音已保留，请试听后决定是否重新生成。"]);
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.analyze).toHaveBeenCalledTimes(2);
    const pcm = await Promise.all(candidate.provenance.paragraph!.segments.map(async segment =>
      paragraphPcmFrames(new Uint8Array(await readFile(resolveClipAssetPath(segment.asset.assetId, f.config)))).pcm));
    expect(Buffer.concat(pcm)).toEqual(Buffer.from(paragraphPcmFrames(f.wav).pcm));
  });
  it("keeps the full original but publishes no partial short candidates if any alignment fails", async () => {
    const f = await fixture();
    const analyze = vi.fn().mockImplementationOnce(f.analyze).mockRejectedValueOnce(new VoiceGroupAnalysisError("不安全", 422, "no_safe_quiet_cut"));
    const { candidate } = await generateVoiceParagraphCandidates({ ...f, clipId: f.clips[1].id, voiceOptions }, { generate: f.generate, analyze });
    expect(candidate.provenance.paragraph).toMatchObject({ checkStatus: "review", segments: [], diagnosticCode: "no_safe_quiet_cut" });
    expect(candidate.asset).toEqual(candidate.provenance.paragraph!.sourceAsset);
    expect(await listAudioCandidates({ config: f.config, projectId: f.project.project_id })).toHaveLength(1);
    expect(new Uint8Array(await readFile(resolveClipAssetPath(candidate.asset.assetId, f.config)))).toEqual(f.wav);
    expect(f.generate).toHaveBeenCalledOnce();
  });
  it("saves failed-sentence recognition in candidate provenance and analysis instead of losing it", async () => {
    const f = await fixture();
    const recognition = { stage: "source_alignment" as const, expectedText: f.clips[0].text,
      followingText: f.clips[1].text, sourceTranscript: "先坐下吧我替你倒杯茶", alignment: {
        expected: "先坐下吧", recognizedPrefix: "先坐下吧我替", reason: "uncertain_word_alignment" } };
    const analyze = vi.fn().mockRejectedValue(new VoiceGroupAnalysisError("无法定位", 422, "uncertain_word_alignment", recognition));
    const { candidate } = await generateVoiceParagraphCandidates({ ...f, clipId: f.clips[1].id, voiceOptions }, { generate: f.generate, analyze });
    expect(candidate.provenance.paragraph).toMatchObject({ checkStatus: "review", failedClipId: f.clips[0].id, failureRecognition: recognition, segments: [] });
    const { recordings } = await listVoiceGenerationRecordings({ config: f.config, projectId: f.project.project_id, clipId: f.clips[1].id, text: f.clips[1].text });
    expect(recordings[0].paragraphRecognition).toMatchObject({ checkStatus: "review", failedClipId: f.clips[0].id, failureRecognition: recognition });
  });
  it("retains canceled native originals in the recordings list of every paragraph member", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const generate = vi.fn(async (input) => { await input.onRawOutput!(f.wav); controller.abort(); return { wav: f.wav, provenance: makeVoiceCandidateFixture().provenance, qualityWarnings: [] }; });
    await expect(generateVoiceParagraphCandidates({ ...f, clipId: f.clips[1].id, voiceOptions, signal: controller.signal }, { generate, analyze: f.analyze })).rejects.toThrow();
    for (const clip of f.clips.slice(0, 2)) {
      const { recordings } = await listVoiceGenerationRecordings({ config: f.config, projectId: f.project.project_id, clipId: clip.id, text: clip.text });
      expect(recordings).toHaveLength(1);
      expect(recordings[0].inputText).toBe(f.clips[0].text + f.clips[1].text);
      const saved = await resolveVoiceGenerationRecording(f.config, recordings[0].recordingId);
      expect(new Uint8Array(await readFile(saved.filePath))).toEqual(f.wav);
    }
    expect(await listAudioCandidates({ config: f.config, projectId: f.project.project_id })).toHaveLength(0);
  });
  it("does not launch native generation for a silent target", async () => {
    const f = await fixture(); f.clips[1].kind = "silent";
    await expect(generateVoiceParagraphCandidates({ ...f, clipId: f.clips[1].id, voiceOptions }, { generate: f.generate })).rejects.toMatchObject({ statusCode: 400 });
    expect(f.generate).not.toHaveBeenCalled();
  });
  it("rejects supplementary-character text exceeding the downstream UTF-16 contract before TTS", async () => {
    const f = await fixture();
    f.clips[0].text = "字".repeat(499) + "🙂";
    f.project.speechWorkspace!.groups = f.clips.map((clip) => ({ id: `paragraph-${clip.id}`, clipIds: [clip.id] }));
    expect(Array.from(f.clips[0].text)).toHaveLength(500);
    expect(f.clips[0].text).toHaveLength(501);
    await expect(generateVoiceParagraphCandidates({ ...f, clipId: f.clips[0].id, voiceOptions }, { generate: f.generate })).rejects.toMatchObject({ statusCode: 400 });
    expect(f.generate).not.toHaveBeenCalled();
  });
  it("rejects paragraph generation from the independent short workspace before calling TTS", async () => {
    const f = await fixture();
    f.project = switchSpeechWorkspace(f.project, "short");
    await expect(generateVoiceParagraphCandidates({ ...f, clipId: f.clips[0].id, voiceOptions }, { generate: f.generate })).rejects.toMatchObject({ statusCode: 400 });
    expect(f.generate).not.toHaveBeenCalled();
    expect(await listAudioCandidates({ config: f.config, projectId: f.project.project_id })).toHaveLength(0);
  });
});
