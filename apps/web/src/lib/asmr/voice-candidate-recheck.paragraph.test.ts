import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { resolveClipAssetPath, saveClipAsset } from "./local-asset-store";
import { discardAudioCandidate, getAudioCandidate, listAudioCandidates, resolveCandidateManifestPath, saveAudioCandidate, saveParagraphAudioCandidates } from "./local-candidate-store";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { writePcm16Wav } from "./pcm-audio";
import { ensureSpeechWorkspaces, switchSpeechWorkspace } from "./speech-workspace";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";
import { recheckVoiceCandidate } from "./voice-candidate-recheck";
import { listVoiceGenerationRecordings, resolveVoiceGenerationRecording } from "./voice-generation-recordings";
import { VoiceGroupAnalysisError, type VoiceGroupAnalysis } from "./voice-group-analysis";
import { getVoiceParagraphContext } from "./voice-paragraph-context";
import { paragraphPcmFrames, sliceParagraphPcmWav } from "./voice-paragraph-split";

const temporaryRoots: string[] = [];
type Dependencies = NonNullable<Parameters<typeof recheckVoiceCandidate>[1]>;
function cuttingAnalysis(input: Parameters<NonNullable<Dependencies["analyze"]>>[0], recognized = input.expectedText, similarity = 1): VoiceGroupAnalysis {
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
  const root = await mkdtemp(path.join(os.tmpdir(), "paragraph-recheck-test-"));
  temporaryRoots.push(root);
  vi.stubEnv("ASMR_VOICE_WORK_ROOT", path.join(root, "voice-work"));
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root });
  const initial = structuredClone(demoProject);
  const initialClips = initial.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  initialClips[0].text = "回来啦。"; initialClips[1].text = "我替你倒杯茶。";
  const project = switchSpeechWorkspace(ensureSpeechWorkspaces(initial), "paragraph");
  const clips = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips;
  project.speechWorkspace!.groups = [{ id: "paragraph-a", clipIds: clips.slice(0, 2).map((clip) => clip.id) },
    ...clips.slice(2).map((clip) => ({ id: `paragraph-${clip.id}`, clipIds: [clip.id] }))];
  const context = getVoiceParagraphContext(project, clips[1].id)!;
  const samples = new Float32Array(96_000);
  samples.fill(.05, 9600, 33_600); samples.fill(-.03, 57_600, 81_600);
  const wav = writePcm16Wav(samples, 48_000);
  const sourceAsset = await saveClipAsset({ config, clipId: "original_paragraph", wav, duration: 2 });
  const base = makeVoiceCandidateFixture();
  const candidate = AudioCandidateSchema.parse({ ...base, clipId: clips[1].id,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clips[1], undefined, context), asset: sourceAsset,
    provenance: { ...base.provenance, generationMode: "paragraph", parameters: { ...base.provenance.parameters,
      maxSteps: 800, generatedSteps: 48, generationCalls: 1, normalization: "none", padding: "none" },
    paragraph: { version: 1, groupId: context.groupId, text: context.text, clipIds: context.clips.map((clip) => clip.clipId),
      sourceAsset, checkStatus: "review", segments: [], diagnosticCode: "uncertain_word_alignment" } },
    qualityWarnings: ["原生模型音质提示", "整段已生成，但短句切分未全部通过检查；完整原音可试听、下载，确认安全分段后才能采用到短句。"] });
  await saveParagraphAudioCandidates({ config, candidates: [candidate] });
  const analyze = vi.fn<NonNullable<Dependencies["analyze"]>>(async input => cuttingAnalysis(input));
  return { root, config, project, clips, context, wav, candidate, analyze, workRoot: path.join(root, "voice-work", "long-text") };
}
const inputFor = (data: Awaited<ReturnType<typeof fixture>>) => ({ project: data.project, clipId: data.candidate.clipId,
  candidateId: data.candidate.candidateId, config: data.config });
async function rewriteCandidate(data: Awaited<ReturnType<typeof fixture>>, edit: (candidate: typeof data.candidate) => void) {
  const manifest = JSON.parse(await readFile(resolveCandidateManifestPath(data.config), "utf8"));
  edit(manifest.candidates[0]);
  await writeFile(resolveCandidateManifestPath(data.config), JSON.stringify(manifest));
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("paragraph-recheck-test-")) {
      throw new Error("Refusing unrelated test cleanup");
    }
    await rm(resolved, { recursive: true, force: true });
  }
});

describe("saved paragraph candidate recognition", () => {
  it("keeps a safely partitioned same-tone final sentence passed without a separate manual-text gate", async () => {
    const data = await fixture();
    data.analyze.mockImplementation(async input => input.followingText ? cuttingAnalysis(input) : cuttingAnalysis(input, "我替你倒杯查", 5 / 6));
    const { candidate } = await recheckVoiceCandidate(inputFor(data), { analyze: data.analyze });
    expect(candidate.provenance.paragraph).toMatchObject({ checkStatus: "passed", segments: [{ clipId: data.clips[0].id },
      { recognition: { analysisMode: "cutting_only", targetTranscript: "我替你倒杯查" } }] });
    expect(candidate.provenance.paragraph!.segments.every(segment => !segment.textReview)).toBe(true);
    expect(candidate.provenance.paragraph!.manualTextConfirmation).toBeUndefined();
    expect(candidate.qualityWarnings).toEqual(["原生模型音质提示"]);
    const recordings = await listVoiceGenerationRecordings({ config: data.config, projectId: data.project.project_id, clipId: data.clips[1].id, text: data.clips[1].text, workspaceMode: "paragraph" });
    expect(recordings.recordings[0]).toMatchObject({ status: "checked", paragraphRecognition: { checkStatus: "passed", segments: [
      { clipId: data.clips[0].id }, { recognition: { targetTranscript: "我替你倒杯查" } }] } });
    expect(recordings.recordings[0].warning).not.toContain("文字待试听确认");
    expect(data.analyze).toHaveBeenCalledTimes(2);
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(data.candidate);
  });
  it("uses the saved paragraph mode's thirty-minute budget and remains active after five minutes", async () => {
    const data = await fixture(), exact = data.analyze.getMockImplementation()!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    data.analyze.mockImplementationOnce(async (input, dependencies) => {
      expect(dependencies?.timeoutMs).toBeGreaterThan(1_790_000);
      expect(dependencies?.timeoutMs).toBeLessThanOrEqual(1_800_000);
      await vi.advanceTimersByTimeAsync(301_000);
      expect(input.signal?.aborted).toBe(false);
      return exact(input, dependencies);
    });
    const result = await recheckVoiceCandidate(inputFor(data), { analyze: data.analyze });
    expect(result.candidate.provenance.paragraph?.checkStatus).toBe("passed");
    expect(data.analyze.mock.calls[1][1]?.timeoutMs).toBeGreaterThan(1_480_000);
    expect(data.analyze.mock.calls[1][1]?.timeoutMs).toBeLessThanOrEqual(1_499_000);
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(data.candidate);
  });
  it("keeps an explicit paragraph deadline rather than expanding it to thirty minutes", async () => {
    const data = await fixture(), before = await readFile(resolveCandidateManifestPath(data.config));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    data.analyze.mockImplementationOnce(async (input, dependencies) => {
      expect(dependencies?.timeoutMs).toBeGreaterThan(4_000);
      expect(dependencies?.timeoutMs).toBeLessThanOrEqual(5_000);
      await vi.advanceTimersByTimeAsync(5_001);
      input.signal?.throwIfAborted();
      throw new Error("unreachable");
    });
    await expect(recheckVoiceCandidate(inputFor(data), { analyze: data.analyze, timeoutMs: 5_000 })).rejects.toMatchObject({ statusCode: 504 });
    expect(await readFile(resolveCandidateManifestPath(data.config))).toEqual(before);
    expect(await readFile(resolveClipAssetPath(data.candidate.asset.assetId, data.config))).toEqual(Buffer.from(data.wav));
    expect(await readdir(path.join(data.root, "locks"))).toEqual([]);
  });
  it("partitions safe original PCM when source ASR omits a particle, preserving the literal evidence without extra confirmation", async () => {
    const data = await fixture();
    data.analyze.mockImplementation(async input => input.followingText ? cuttingAnalysis(input, "回来", 2 / 3) : cuttingAnalysis(input));
    const result = await recheckVoiceCandidate(inputFor(data), { analyze: data.analyze });
    expect(data.analyze).toHaveBeenCalledTimes(2);
    const paragraph = result.candidate.provenance.paragraph!;
    expect(paragraph).toMatchObject({ checkStatus: "passed", segments: [{ recognition: { analysisMode: "cutting_only", targetTranscript: "回来" } }, { clipId: data.clips[1].id }] });
    expect(paragraph.segments.every(segment => !segment.textReview)).toBe(true);
    expect(paragraph.manualTextConfirmation).toBeUndefined();
    expect(result.candidate.asset).toEqual(paragraph.segments[1].asset);
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(data.candidate);
    expect((await listAudioCandidates({ config: data.config, projectId: data.project.project_id })).filter((item) => item.candidateId !== data.candidate.candidateId)).toHaveLength(2);
    const payloads = await Promise.all(paragraph.segments.map(async (segment) => paragraphPcmFrames(new Uint8Array(await readFile(resolveClipAssetPath(segment.asset.assetId, data.config)))).pcm));
    expect(Buffer.concat(payloads)).toEqual(Buffer.from(paragraphPcmFrames(data.wav).pcm));
    const recordings = await listVoiceGenerationRecordings({ config: data.config, projectId: data.project.project_id, clipId: data.clips[0].id, text: data.clips[0].text, workspaceMode: "paragraph" });
    expect(recordings.recordings[0]).toMatchObject({ status: "checked", paragraphRecognition: { checkStatus: "passed", segments: [
      { recognition: { targetTranscript: "回来" } }, { clipId: data.clips[1].id }] } });
  });
  it("cuts the exact saved original, publishes all sibling candidates atomically, and retains the original native recipe and results", async () => {
    const data = await fixture();
    const projectBefore = JSON.stringify(data.project);
    const result = await recheckVoiceCandidate(inputFor(data), { analyze: data.analyze });
    const updated = result.candidate;
    expect(updated.candidateId).not.toBe(data.candidate.candidateId);
    expect(updated.clipId).toBe(data.clips[1].id);
    expect(updated.provenance).toMatchObject({ seed: 1234, voicePackId: "soft_zh", referenceMode: "with_reference_text",
      parameters: { cfg: 2, timesteps: 10, gpuLayers: 0, lowVram: true, maxSteps: 800, generatedSteps: 48,
        generationCalls: 0, recheckCalls: 1, normalization: "none", padding: "none", recheckedFromCandidateId: data.candidate.candidateId },
      paragraph: { checkStatus: "passed", sourceAsset: data.candidate.provenance.paragraph!.sourceAsset } });
    expect(updated.qualityWarnings).toEqual(["原生模型音质提示"]);
    expect(data.analyze).toHaveBeenCalledTimes(2);
    expect(data.analyze.mock.calls[0][0]).toMatchObject({ expectedText: "回来啦。", followingText: "我替你倒杯茶。", requireTwoSided: true });
    expect(data.analyze.mock.calls[0][0].wav).toEqual(data.wav);
    for (const [, dependencies] of data.analyze.mock.calls) expect(dependencies).toMatchObject({ env: {}, runtimeSession: { runtimeRoot: path.resolve(data.root) } });
    const siblings = (await listAudioCandidates({ config: data.config, projectId: data.project.project_id, workspaceMode: "paragraph" }))
      .filter((candidate) => candidate.candidateId !== data.candidate.candidateId);
    expect(siblings).toHaveLength(2);
    expect(siblings.map((candidate) => candidate.provenance.paragraph)).toEqual([updated.provenance.paragraph, updated.provenance.paragraph]);
    const payloads = await Promise.all(updated.provenance.paragraph!.segments.map(async (segment) =>
      paragraphPcmFrames(new Uint8Array(await readFile(resolveClipAssetPath(segment.asset.assetId, data.config)))).pcm));
    expect(Buffer.concat(payloads)).toEqual(Buffer.from(paragraphPcmFrames(data.wav).pcm));
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(data.candidate);
    expect(JSON.stringify(data.project)).toBe(projectBefore);
    expect(await readdir(path.join(data.root, "locks"))).toEqual([]);
    const trace = path.join(data.workRoot, (await readdir(data.workRoot))[0]);
    expect(JSON.parse(await readFile(path.join(trace, "plan.json"), "utf8"))).toMatchObject({ generationCalls: 0, recheckCalls: 1,
      recheckedFromCandidateId: data.candidate.candidateId, sourceAsset: data.candidate.provenance.paragraph!.sourceAsset });
    expect(await readFile(path.join(trace, "group-1-take-1-source.wav"))).toEqual(Buffer.from(data.wav));
    for (const clip of data.clips.slice(0, 2)) {
      const list = await listVoiceGenerationRecordings({ config: data.config, projectId: data.project.project_id, clipId: clip.id, text: clip.text, workspaceMode: "paragraph" });
      expect(list.recordings).toHaveLength(1);
      expect(list.recordings[0]).toMatchObject({ status: "checked", paragraphRecognition: { checkStatus: "passed", segments: [{ clipId: data.clips[0].id }, { clipId: data.clips[1].id }] } });
      const source = await resolveVoiceGenerationRecording(data.config, list.recordings[0].recordingId);
      expect(await readFile(source.filePath)).toEqual(Buffer.from(data.wav));
    }
    const shortList = await listVoiceGenerationRecordings({ config: data.config, projectId: data.project.project_id, clipId: data.clips[0].id, text: data.clips[0].text, workspaceMode: "short" });
    expect(shortList.recordings).toEqual([]);
    await recheckVoiceCandidate({ ...inputFor(data), candidateId: updated.candidateId }, { analyze: data.analyze });
    expect(data.analyze.mock.calls[2][0].wav).toEqual(data.wav);
  });

  it("retains a later whole-recording integrity failure's exact evidence and full original without publishing partial cuts", async () => {
    const data = await fixture();
    const recognition = { stage: "boundary_check" as const, analysisMode: "cutting_only" as const,
      sourceTranscript: "我替你倒茶", expectedText: data.clips[1].text };
    data.analyze.mockRejectedValueOnce(new VoiceGroupAnalysisError("位置未确认", 422, "boundary_unlocatable", {
      stage: "source_alignment", analysisMode: "cutting_only", sourceTranscript: "回来了我替你倒茶",
      expectedText: data.clips[0].text, followingText: data.clips[1].text }));
    const first = await recheckVoiceCandidate(inputFor(data), { analyze: data.analyze });
    expect(first.candidate.provenance.paragraph).toMatchObject({ checkStatus: "review", segments: [], failedClipId: data.clips[0].id,
      failureRecognition: { sourceTranscript: "回来了我替你倒茶" } });
    data.analyze.mockClear();
    data.analyze.mockImplementationOnce(data.analyze.getMockImplementation()!);
    data.analyze.mockRejectedValueOnce(new VoiceGroupAnalysisError("完整PCM响应无法核实", 422, "unsafe_cutting_boundary", recognition));
    const result = await recheckVoiceCandidate(inputFor(data), { analyze: data.analyze });
    expect(result.candidate.provenance.paragraph).toMatchObject({ checkStatus: "review", segments: [], diagnosticCode: "unsafe_cutting_boundary",
      failedClipId: data.clips[1].id, failureRecognition: recognition });
    expect(result.candidate.asset).toEqual(data.candidate.asset);
    expect(await readFile(resolveClipAssetPath(result.candidate.asset.assetId, data.config))).toEqual(Buffer.from(data.wav));
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(data.candidate);
    expect(await listAudioCandidates({ config: data.config, projectId: data.project.project_id })).toHaveLength(3);
    const recordings = await listVoiceGenerationRecordings({ config: data.config, projectId: data.project.project_id,
      clipId: data.clips[0].id, text: data.clips[0].text, workspaceMode: "paragraph" });
    expect(recordings.recordings[0]).toMatchObject({ status: "needs_review", paragraphRecognition: { failedClipId: data.clips[1].id, failureRecognition: recognition } });
  });

  it("rechecks an original at its native step budget instead of treating that metadata as a cut failure", async () => {
    const data = await fixture();
    await rewriteCandidate(data, candidate => { candidate.provenance.parameters.generatedSteps = 800; });
    const original = await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId });
    const { candidate } = await recheckVoiceCandidate(inputFor(data), { analyze: data.analyze });
    expect(candidate.provenance.paragraph?.checkStatus).toBe("passed");
    expect(candidate.provenance.parameters).toMatchObject({ generatedSteps: 800, maxSteps: 800, generationCalls: 0, recheckCalls: 1 });
    expect(data.analyze).toHaveBeenCalledTimes(2);
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(original);
  });

  it.each(["foreign", "short", "text", "ids", "group", "style", "silent", "discarded", "missing"])("rejects %s source changes before ASR", async (kind) => {
    const data = await fixture();
    if (kind === "foreign") data.project.project_id = "foreign";
    if (kind === "short") data.project = switchSpeechWorkspace(data.project, "short");
    if (kind === "text") data.clips[0].text += "安心吧。";
    if (kind === "ids") data.project.speechWorkspace!.groups[0].clipIds.reverse();
    if (kind === "group") data.project.speechWorkspace!.groups[0].id = "wrong_group";
    if (kind === "style") data.clips[0].style = "normal";
    if (kind === "silent") data.clips[0].kind = "silent";
    if (kind === "discarded") await rewriteCandidate(data, (candidate) => { candidate.status = "discarded"; });
    const before = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    await expect(recheckVoiceCandidate({ ...inputFor(data), ...(kind === "missing" ? { candidateId: "missing" } : {}) }, { analyze: data.analyze }))
      .rejects.toMatchObject({ statusCode: ["foreign", "discarded", "missing"].includes(kind) ? 404 : kind === "short" ? 400 : 409 });
    expect(data.analyze).not.toHaveBeenCalled();
    expect(await readFile(resolveCandidateManifestPath(data.config), "utf8")).toBe(before);
  });

  it.each(["missing", "duration", "stereo"])("does not replace an invalid %s original with the candidate cut or a nearby trace", async (kind) => {
    const data = await fixture();
    const filePath = resolveClipAssetPath(data.candidate.asset.assetId, data.config);
    if (kind === "missing") await rm(filePath);
    if (kind === "duration") await writeFile(filePath, writePcm16Wav(new Float32Array(48_000), 48_000));
    if (kind === "stereo") await writeFile(filePath, writePcm16Wav(new Float32Array(192_000), 48_000, 2));
    const before = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    await expect(recheckVoiceCandidate(inputFor(data), { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 422 });
    expect(data.analyze).not.toHaveBeenCalled();
    expect(await readFile(resolveCandidateManifestPath(data.config), "utf8")).toBe(before);
  });

  it.skipIf(process.platform === "win32")("rejects a symbolic-link source instead of following it outside the asset store", async () => {
    const data = await fixture();
    const filePath = resolveClipAssetPath(data.candidate.asset.assetId, data.config);
    const otherPath = path.join(data.root, "foreign.wav"); await writeFile(otherPath, data.wav);
    await rm(filePath); await symlink(otherPath, filePath);
    await expect(recheckVoiceCandidate(inputFor(data), { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 422 });
    expect(data.analyze).not.toHaveBeenCalled();
  });

  it("checks every paragraph member's independent capacity before ASR", async () => {
    const data = await fixture();
    for (let index = 0; index < 12; index++) {
      await saveParagraphAudioCandidates({ config: data.config, candidates: [AudioCandidateSchema.parse({ ...data.candidate,
        candidateId: `full_${index}`, clipId: data.clips[0].id, sourceFingerprint: getVoiceCandidateSourceFingerprint(data.clips[0], undefined, data.context) })] });
    }
    await expect(recheckVoiceCandidate(inputFor(data), { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 409 });
    expect(data.analyze).not.toHaveBeenCalled();
  });

  it("allows full short-mode capacity without consuming or replacing it", async () => {
    const data = await fixture();
    for (let index = 0; index < 12; index++) await saveAudioCandidate({ config: data.config,
      candidate: makeVoiceCandidateFixture({ candidateId: `short_${index}`, clipId: data.clips[0].id }) });
    const shortBefore = await listAudioCandidates({ config: data.config, projectId: data.project.project_id, workspaceMode: "short" });
    await recheckVoiceCandidate(inputFor(data), { analyze: data.analyze });
    expect(await listAudioCandidates({ config: data.config, projectId: data.project.project_id, workspaceMode: "short" })).toEqual(shortBefore);
  });

  it("does not publish if the authoritative source is discarded during the long ASR step", async () => {
    const data = await fixture();
    const first = data.analyze.getMockImplementation()!;
    data.analyze.mockImplementationOnce(async (...args) => {
      await discardAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId, projectId: data.project.project_id, clipId: data.candidate.clipId });
      return first(...args);
    });
    await expect(recheckVoiceCandidate(inputFor(data), { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 409 });
    const candidates = await listAudioCandidates({ config: data.config, projectId: data.project.project_id, includeDiscarded: true });
    expect(candidates).toHaveLength(1); expect(candidates[0].status).toBe("discarded");
  });

  it("checks the immutable source again under the atomic manifest lock", async () => {
    const data = await fixture();
    await discardAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId, projectId: data.project.project_id, clipId: data.candidate.clipId });
    await expect(saveParagraphAudioCandidates({ config: data.config, candidates: [{ ...data.candidate, candidateId: "recheck_new" }],
      sourceCandidate: data.candidate })).rejects.toMatchObject({ statusCode: 409 });
    expect(await listAudioCandidates({ config: data.config, projectId: data.project.project_id, includeDiscarded: true })).toHaveLength(1);
  });

  it("binds atomic recheck publication to the same full source asset and canonical paragraph", async () => {
    const data = await fixture();
    const changed = structuredClone(data.candidate);
    changed.candidateId = "other_original";
    const other = { ...changed.asset, assetId: "other_source", uri: "asset://clip/other_source" };
    changed.asset = other; changed.provenance.paragraph!.sourceAsset = other;
    await expect(saveParagraphAudioCandidates({ config: data.config, candidates: [changed], sourceCandidate: data.candidate }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await listAudioCandidates({ config: data.config, projectId: data.project.project_id })).toEqual([data.candidate]);
  });

  it("rejects a changed shared source after ASR instead of publishing stale cuts", async () => {
    const data = await fixture();
    const analyze = data.analyze.getMockImplementation()!;
    data.analyze.mockImplementationOnce(async (...args) => {
      data.clips[0].text = "新台词。";
      return analyze(...args);
    });
    const before = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    await expect(recheckVoiceCandidate(inputFor(data), { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(resolveCandidateManifestPath(data.config), "utf8")).toBe(before);
  });

  it("keeps the whole sibling set unpublished if another request fills one member's capacity during ASR", async () => {
    const data = await fixture();
    const analyze = data.analyze.getMockImplementation()!;
    data.analyze.mockImplementationOnce(async (...args) => {
      for (let index = 0; index < 12; index++) {
        await saveParagraphAudioCandidates({ config: data.config, candidates: [AudioCandidateSchema.parse({ ...data.candidate,
          candidateId: `concurrent_${index}`, clipId: data.clips[0].id,
          sourceFingerprint: getVoiceCandidateSourceFingerprint(data.clips[0], undefined, data.context) })] });
      }
      return analyze(...args);
    });
    await expect(recheckVoiceCandidate(inputFor(data), { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 409 });
    const candidates = await listAudioCandidates({ config: data.config, projectId: data.project.project_id, workspaceMode: "paragraph" });
    expect(candidates).toHaveLength(13);
    expect(candidates.every((candidate) => candidate.candidateId === data.candidate.candidateId || candidate.candidateId.startsWith("concurrent_"))).toBe(true);
  });

  it.each(["cancel", "timeout", "runtime"])("preserves originals and publishes no candidates on %s failures", async (kind) => {
    const data = await fixture();
    const controller = new AbortController();
    const before = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    if (kind === "runtime") data.analyze.mockRejectedValueOnce(new VoiceGroupAnalysisError("环境不可用", 503));
    else data.analyze.mockImplementationOnce(async (input) => {
      if (kind === "cancel") controller.abort();
      await new Promise<void>((_, reject) => {
        const rejectAbort = () => reject(input.signal!.reason);
        if (input.signal!.aborted) rejectAbort(); else input.signal!.addEventListener("abort", rejectAbort, { once: true });
      });
      throw new Error("unreachable");
    });
    await expect(recheckVoiceCandidate({ ...inputFor(data), signal: controller.signal }, { analyze: data.analyze,
      ...(kind === "timeout" ? { timeoutMs: 30 } : {}) })).rejects.toMatchObject({ statusCode: kind === "cancel" ? 499 : kind === "timeout" ? 504 : 503 });
    expect(await readFile(resolveCandidateManifestPath(data.config), "utf8")).toBe(before);
    expect(await readFile(resolveClipAssetPath(data.candidate.asset.assetId, data.config))).toEqual(Buffer.from(data.wav));
    expect(await readdir(path.join(data.root, "locks"))).toEqual([]);
  });

  it("respects an existing runtime reservation without starting ASR", async () => {
    const data = await fixture();
    await mkdir(path.join(data.root, "locks"), { recursive: true });
    await writeFile(path.join(data.root, "locks", "voxcpm2-generation.lock"), "another request");
    await expect(recheckVoiceCandidate(inputFor(data), { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 409 });
    expect(data.analyze).not.toHaveBeenCalled();
  });
});
