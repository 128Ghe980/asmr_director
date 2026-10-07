import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioCandidateSchema, getVoiceCandidateSourceFingerprint } from "./audio-candidate";
import { getAudioCandidate, listAudioCandidates, resolveCandidateManifestPath, saveAudioCandidate } from "./local-candidate-store";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { demoProject } from "./mock-project";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { makeVoiceCandidateFixture, makeVoiceLongTextResultFixture } from "./voice-candidate-fixture";
import { recheckVoiceCandidate } from "./voice-candidate-recheck";
import { VoiceGroupAnalysisError, type VoiceGroupAnalysis } from "./voice-group-analysis";
import { buildLongTextInputs } from "./voice-longtext-plan";
import { getVoiceReviewWarning } from "./voice-review-warning";
import { flattenClips } from "./view-model";

const temporaryRoots: string[] = [];
const runId = "c6953f1e-bfd9-4c65-9569-0775e1537693";
type Dependencies = NonNullable<Parameters<typeof recheckVoiceCandidate>[1]>;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "voice-recheck-test-"));
  temporaryRoots.push(root);
  vi.stubEnv("ASMR_VOICE_WORK_ROOT", path.join(root, "voice-work"));
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root });
  const project = structuredClone(demoProject);
  const clip = flattenClips(project).find((item) => item.id === "voice_001")!;
  if (clip.type !== "voice") throw new Error("Expected a voice fixture");
  const longText = makeVoiceLongTextResultFixture();
  clip.text = longText.plan!.clauses.join("");
  clip.semantic_unit = undefined;
  longText.groups.forEach((group) => {
    group.checkStatus = "review";
    group.diagnosticCode = "unrecognized_continuation";
    group.internalPausesMs = [];
  });
  const base = makeVoiceCandidateFixture();
  const candidate = AudioCandidateSchema.parse({ ...base,
    sourceFingerprint: getVoiceCandidateSourceFingerprint(clip),
    provenance: { ...base.provenance, generationMode: "long_text", longText },
    qualityWarnings: ["原生模型音质提示", ...longText.groups.map((group) => getVoiceReviewWarning(group.index, group.text, group.diagnosticCode,
      "识别文字与目标台词存在差异")),
      "本候选保留了待确认组的完整原音，可能包含后续台词、补句或重复内容；各次完整原音都可单独试听、下载，请听后决定是否采用。"],
  });
  await saveAudioCandidate({ config, candidate });
  const workRoot = path.join(root, "voice-work", "long-text");
  const trace = path.join(workRoot, runId);
  await mkdir(trace, { recursive: true });
  const targets = buildLongTextInputs(longText.plan!);
  const plan = { plan: longText.plan, targets, projectId: project.project_id, clipId: clip.id,
    sourceFingerprint: candidate.sourceFingerprint, createdAt: candidate.createdAt };
  await writeFile(path.join(trace, "plan.json"), JSON.stringify(plan));
  await writeFile(path.join(trace, "result.json"), JSON.stringify(longText));
  await writeFile(path.join(trace, "groups.json"), JSON.stringify(longText.groups));
  const originals = longText.groups.map((_, index) => writePcm16Wav(Float32Array.from({ length: 48_000 * 3 },
    (_, position) => position < 96_000 ? Math.sin(position * .2) * (.1 + index * .01) : 0), 48_000));
  for (const group of longText.groups) {
    const prefix = `group-${group.index + 1}-take-1`;
    await writeFile(path.join(trace, `${prefix}-source.wav`), originals[group.index]);
    await writeFile(path.join(trace, `${prefix}-source.json`), JSON.stringify({ ...base.provenance,
      seed: group.seed, parameters: group.parameters, runtimeVersion: group.runtimeVersion, referenceIdentity: group.referenceIdentity }));
  }
  const analyze = vi.fn<NonNullable<Dependencies["analyze"]>>(async (input) => {
    const index = targets.findIndex((target) => target.expectedText === input.expectedText);
    const wav = writePcm16Wav(decodePcmWav(input.wav).samples.slice(0, 48_000), 48_000);
    return { wav, internalPausesMs: [180], leadingQuietMs: 10, trailingQuietMs: 10,
      transcript: input.expectedText, coverage: 1, cutStartSeconds: 0, cutEndSeconds: 1,
      asrModel: "faster-whisper-large-v3/cpu/int8", recognition: { stage: "complete", sourceTranscript: `${input.expectedText}后文`,
        targetTranscript: input.expectedText, expectedText: input.expectedText,
        ...(targets[index].followingText ? { followingText: targets[index].followingText } : {}) } } satisfies VoiceGroupAnalysis;
  });
  return { root, config, project, clip, candidate, longText, targets, trace, workRoot, originals, analyze };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("voice-recheck-test-")) {
      throw new Error("Refusing unrelated test cleanup");
    }
    await rm(resolved, { recursive: true, force: true });
  }
});

describe("saved voice candidate recognition", () => {
  it("reanalyzes each precisely owned full original locally, saves a new candidate and keeps the old candidate/source", async () => {
    const data = await fixture();
    const oldManifest = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    const result = await recheckVoiceCandidate({ project: data.project, clipId: data.clip.id,
      candidateId: data.candidate.candidateId, config: data.config }, { analyze: data.analyze });
    expect(result.candidate.candidateId).not.toBe(data.candidate.candidateId);
    expect(result.candidate.asset.assetId).not.toBe(data.candidate.asset.assetId);
    expect(result.candidate.provenance.seed).toBe(data.candidate.provenance.seed);
    expect(result.candidate.provenance.voicePackId).toBe(data.candidate.provenance.voicePackId);
    expect(result.candidate.provenance.parameters.recheckedFromCandidateId).toBe(data.candidate.candidateId);
    expect(result.candidate.qualityWarnings).toEqual(["原生模型音质提示"]);
    expect(result.candidate.provenance.longText!.groups.every((group) => group.checkStatus === "passed" && group.diagnosticCode === undefined)).toBe(true);
    expect(data.analyze).toHaveBeenCalledTimes(2);
    data.analyze.mock.calls.forEach(([input, dependencies], index) => {
      expect(input.wav).toEqual(data.originals[index]);
      expect(input.expectedText).toBe(data.targets[index].expectedText);
      expect(input.followingText).toBe(data.targets[index].followingText);
      expect(dependencies).toMatchObject({ env: {}, runtimeSession: { runtimeRoot: path.resolve(data.root) } });
    });
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(data.candidate);
    const manifest = JSON.parse(await readFile(resolveCandidateManifestPath(data.config), "utf8"));
    expect(manifest.candidates.slice(0, 1)).toEqual(JSON.parse(oldManifest).candidates);
    for (const group of data.longText.groups) expect(await readFile(path.join(data.trace,
      `group-${group.index + 1}-take-1-source.wav`))).toEqual(Buffer.from(data.originals[group.index]));
    const newRuns = (await readdir(data.workRoot)).filter((name) => name !== runId);
    expect(newRuns).toHaveLength(1);
    const newTrace = path.join(data.workRoot, newRuns[0]);
    expect(JSON.parse(await readFile(path.join(newTrace, "plan.json"), "utf8"))).toMatchObject({
      recheckedFromCandidateId: data.candidate.candidateId, sourceFingerprint: data.candidate.sourceFingerprint });
    expect(JSON.parse(await readFile(path.join(newTrace, "result.json"), "utf8"))).toEqual(result.candidate.provenance.longText);
    expect(await listAudioCandidates({ config: data.config, projectId: data.project.project_id })).toHaveLength(2);
    expect(await readdir(path.join(data.root, "locks"))).toEqual([]);
    // A newly checked candidate remains eligible without choosing an older crop.
    await recheckVoiceCandidate({ project: data.project, clipId: data.clip.id, candidateId: result.candidate.candidateId,
      config: data.config }, { analyze: data.analyze });
    expect(data.analyze.mock.calls[2][0].wav).toEqual(data.originals[0]);
  });

  it.each(["missing", "foreign", "discarded", "stale", "clip", "no_plan"])("rejects %s candidates before ASR", async (kind) => {
    const data = await fixture();
    if (kind === "foreign") data.project.project_id = "foreign_project";
    if (kind === "stale") data.clip.text += "现在休息。";
    if (["discarded", "clip", "no_plan"].includes(kind)) {
      const manifest = JSON.parse(await readFile(resolveCandidateManifestPath(data.config), "utf8"));
      if (kind === "discarded") manifest.candidates[0].status = "discarded";
      if (kind === "clip") { manifest.candidates[0].provenance.generationMode = "clip"; delete manifest.candidates[0].provenance.longText; }
      if (kind === "no_plan") delete manifest.candidates[0].provenance.longText.plan;
      await writeFile(resolveCandidateManifestPath(data.config), JSON.stringify(manifest));
    }
    const before = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    await expect(recheckVoiceCandidate({ project: data.project, clipId: data.clip.id,
      candidateId: kind === "missing" ? "not_found" : data.candidate.candidateId, config: data.config }, { analyze: data.analyze })).rejects.toMatchObject({
      statusCode: ["clip", "no_plan"].includes(kind) ? 400 : kind === "stale" ? 409 : 404,
    });
    expect(data.analyze).not.toHaveBeenCalled();
    expect(await readFile(resolveCandidateManifestPath(data.config), "utf8")).toBe(before);
  });

  it.each(["owner", "fingerprint", "targets", "group_asset", "missing_full_source", "wrong_seed", "duplicate"])("never guesses source for invalid %s trace", async (kind) => {
    const data = await fixture();
    const planPath = path.join(data.trace, "plan.json");
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    if (kind === "owner") plan.projectId = "other_project";
    if (kind === "fingerprint") plan.sourceFingerprint = "old text";
    if (kind === "targets") plan.targets[0].text += "错误后文";
    await writeFile(planPath, JSON.stringify(plan));
    if (kind === "group_asset") {
      const result = JSON.parse(await readFile(path.join(data.trace, "result.json"), "utf8"));
      result.groups[0].asset.assetId = "unrelated"; result.groups[0].asset.uri = "asset://clip/unrelated";
      await writeFile(path.join(data.trace, "result.json"), JSON.stringify(result));
    }
    if (kind === "missing_full_source") await rm(path.join(data.trace, "group-1-take-1-source.wav"));
    if (kind === "wrong_seed") {
      const source = JSON.parse(await readFile(path.join(data.trace, "group-1-take-1-source.json"), "utf8"));
      source.seed++;
      await writeFile(path.join(data.trace, "group-1-take-1-source.json"), JSON.stringify(source));
    }
    if (kind === "duplicate") {
      const duplicate = path.join(data.workRoot, "d6953f1e-bfd9-4c65-9569-0775e1537693");
      await mkdir(duplicate);
      for (const name of await readdir(data.trace)) await writeFile(path.join(duplicate, name), await readFile(path.join(data.trace, name)));
    }
    const before = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    await expect(recheckVoiceCandidate({ project: data.project, clipId: data.clip.id,
      candidateId: data.candidate.candidateId, config: data.config }, { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 422 });
    expect(data.analyze).not.toHaveBeenCalled();
    expect(await readFile(resolveCandidateManifestPath(data.config), "utf8")).toBe(before);
  });

  it("keeps uncertain groups as full originals in a separate review candidate with fresh evidence", async () => {
    const data = await fixture();
    const recognition = { stage: "target_validation" as const, sourceTranscript: "实际识别文本", expectedText: data.targets[0].expectedText,
      followingText: data.targets[0].followingText };
    data.analyze.mockRejectedValueOnce(new VoiceGroupAnalysisError("检查未通过", 422, "cut_text_mismatch", recognition));
    const result = await recheckVoiceCandidate({ project: data.project, clipId: data.clip.id,
      candidateId: data.candidate.candidateId, config: data.config }, { analyze: data.analyze });
    const group = result.candidate.provenance.longText!.groups[0];
    expect(group).toMatchObject({ checkStatus: "review", recognition, diagnosticCode: "cut_text_mismatch", cutStartSeconds: 0, cutEndSeconds: 3 });
    expect(await readFile(path.join(data.config.clipAssetRoot, `${group.asset.assetId}.wav`))).toEqual(Buffer.from(data.originals[0]));
    expect(result.candidate.provenance.longText!.groups[1].checkStatus).toBe("passed");
    expect(result.candidate.qualityWarnings.some((warning) => warning.includes("完整原音"))).toBe(true);
    expect(await getAudioCandidate({ config: data.config, candidateId: data.candidate.candidateId })).toEqual(data.candidate);
  });

  it("does not publish a candidate when the local recognition runtime fails", async () => {
    const data = await fixture();
    data.analyze.mockRejectedValueOnce(new VoiceGroupAnalysisError("录音检查环境未就绪", 503));
    const before = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    await expect(recheckVoiceCandidate({ project: data.project, clipId: data.clip.id,
      candidateId: data.candidate.candidateId, config: data.config }, { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 503 });
    expect(await readFile(resolveCandidateManifestPath(data.config), "utf8")).toBe(before);
    expect(await readdir(data.workRoot)).toEqual([runId]);
  });

  it("finds rerolled groups and inherited groups in their distinct exact original traces", async () => {
    const data = await fixture();
    const rerolled = structuredClone(data.candidate);
    const result = rerolled.provenance.longText!;
    result.baseCandidateId = "base_before_reroll";
    result.rerolledGroup = 1;
    result.groups[1].asset = { assetId: "rerolled_group_2", uri: "asset://clip/rerolled_group_2", duration: 3 };
    result.groups[1].seed = 999;
    const manifest = JSON.parse(await readFile(resolveCandidateManifestPath(data.config), "utf8"));
    manifest.candidates[0] = rerolled;
    await writeFile(resolveCandidateManifestPath(data.config), JSON.stringify(manifest));
    const rerollTrace = path.join(data.workRoot, "d6953f1e-bfd9-4c65-9569-0775e1537693");
    await mkdir(rerollTrace);
    await writeFile(path.join(rerollTrace, "plan.json"), await readFile(path.join(data.trace, "plan.json")));
    await writeFile(path.join(rerollTrace, "result.json"), JSON.stringify(result));
    await writeFile(path.join(rerollTrace, "groups.json"), JSON.stringify(result.groups));
    const original = writePcm16Wav(new Float32Array(48_000 * 4).fill(.08), 48_000);
    await writeFile(path.join(rerollTrace, "group-2-take-1-source.wav"), original);
    const source = JSON.parse(await readFile(path.join(data.trace, "group-2-take-1-source.json"), "utf8"));
    source.seed = 999;
    await writeFile(path.join(rerollTrace, "group-2-take-1-source.json"), JSON.stringify(source));
    const rechecked = await recheckVoiceCandidate({ project: data.project, clipId: data.clip.id,
      candidateId: rerolled.candidateId, config: data.config }, { analyze: data.analyze });
    expect(data.analyze.mock.calls[0][0].wav).toEqual(data.originals[0]);
    expect(data.analyze.mock.calls[1][0].wav).toEqual(original);
    expect(rechecked.candidate.provenance.longText).toMatchObject({ baseCandidateId: "base_before_reroll", rerolledGroup: 1 });
    expect(rechecked.candidate.provenance.longText!.groups[1].seed).toBe(999);
  });

  it.each(["cancel", "timeout"])("propagates %s to the owned analysis and does not publish a candidate", async (kind) => {
    const data = await fixture();
    const controller = new AbortController();
    data.analyze.mockImplementation(async ({ signal }) => new Promise((_, reject) => {
      signal!.addEventListener("abort", () => reject(new VoiceGroupAnalysisError("已取消", 499)), { once: true });
      if (kind === "cancel") controller.abort();
    }));
    const before = await readFile(resolveCandidateManifestPath(data.config), "utf8");
    await expect(recheckVoiceCandidate({ project: data.project, clipId: data.clip.id, candidateId: data.candidate.candidateId,
      config: data.config, signal: controller.signal }, { analyze: data.analyze, timeoutMs: 30 })).rejects.toMatchObject({ statusCode: kind === "cancel" ? 499 : 504 });
    expect(await readFile(resolveCandidateManifestPath(data.config), "utf8")).toBe(before);
    expect(await readdir(path.join(data.root, "locks"))).toEqual([]);
  });

  it("rejects busy shared runtime before analysis", async () => {
    const data = await fixture();
    await mkdir(path.join(data.root, "locks"), { recursive: true });
    await writeFile(path.join(data.root, "locks", "voxcpm2-generation.lock"), "another owner");
    await expect(recheckVoiceCandidate({ project: data.project, clipId: data.clip.id,
      candidateId: data.candidate.candidateId, config: data.config }, { analyze: data.analyze })).rejects.toMatchObject({ statusCode: 409 });
    expect(data.analyze).not.toHaveBeenCalled();
    expect(await readFile(path.join(data.root, "locks", "voxcpm2-generation.lock"), "utf8")).toBe("another owner");
  });
});
