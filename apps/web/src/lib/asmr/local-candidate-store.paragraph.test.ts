import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AudioCandidateSchema } from "./audio-candidate";
import { countAudioCandidates, discardAudioCandidate, ensureAudioCandidateCapacity, listAudioCandidates, resolveCandidateManifestPath, saveAudioCandidate, saveParagraphAudioCandidates } from "./local-candidate-store";
import { makeVoiceCandidateFixture } from "./voice-candidate-fixture";

async function runtime() { return { runtimeRoot: await mkdtemp(path.join(os.tmpdir(), "asmr-paragraph-store-")) }; }
function take(takeId = "take1", projectId = "project_1") {
  const asset = (id: string, duration: number) => ({ assetId: id, uri: `asset://clip/${id}`, duration });
  const paragraph = { version: 1, groupId: "group-a", text: "第一句。第二句。", clipIds: ["voice_a", "voice_b"],
    sourceAsset: asset(`${takeId}_source`, 4), checkStatus: "passed", segments: [
      { clipId: "voice_a", text: "第一句。", asset: asset(`${takeId}_a`, 2), cutStartSeconds: 0, cutEndSeconds: 2 },
      { clipId: "voice_b", text: "第二句。", asset: asset(`${takeId}_b`, 2), cutStartSeconds: 2, cutEndSeconds: 4 },
    ] };
  const base = makeVoiceCandidateFixture();
  return paragraph.segments.map((segment, index) => AudioCandidateSchema.parse({ ...base, projectId, clipId: segment.clipId,
    candidateId: `${takeId}_${index}`, asset: segment.asset, provenance: { ...base.provenance, generationMode: "paragraph", paragraph } }));
}

describe("paragraph candidate manifest operations", () => {
  it("publishes every sibling together and frees all siblings when any member rejects a take", async () => {
    const config = await runtime();
    for (let index = 0; index < 12; index++) await saveParagraphAudioCandidates({ config, candidates: take(`take${index}`) });
    await expect(ensureAudioCandidateCapacity({ config, projectId: "project_1", clipId: "voice_b", workspaceMode: "paragraph" })).rejects.toMatchObject({ statusCode: 409 });
    await discardAudioCandidate({ config, candidateId: "take0_0", projectId: "project_1", clipId: "voice_a" });
    expect(await countAudioCandidates({ config, projectId: "project_1", clipId: "voice_a", workspaceMode: "paragraph" })).toBe(11);
    expect(await countAudioCandidates({ config, projectId: "project_1", clipId: "voice_b", workspaceMode: "paragraph" })).toBe(11);
    await expect(saveParagraphAudioCandidates({ config, candidates: take("take13") })).resolves.toHaveLength(2);
    const discarded = (await listAudioCandidates({ config, projectId: "project_1", includeDiscarded: true })).filter((candidate) => candidate.status === "discarded");
    expect(discarded.map((candidate) => candidate.candidateId)).toEqual(["take0_0", "take0_1"]);
  });
  it("does not publish the first sibling if a later member has reached capacity", async () => {
    const config = await runtime();
    for (let index = 0; index < 12; index++) await saveAudioCandidate({ config, candidate: take(`prior_${index}`)[1] });
    const before = await readFile(resolveCandidateManifestPath(config), "utf8");
    await expect(saveParagraphAudioCandidates({ config, candidates: take() })).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(resolveCandidateManifestPath(config), "utf8")).toBe(before);
    expect(await listAudioCandidates({ config, projectId: "project_1", clipId: "voice_a" })).toHaveLength(0);
  });
  it("keeps other takes, projects and all original WAVs while discarding a shared take", async () => {
    const config = await runtime();
    for (const candidates of [take(), take("other_take"), take("take1", "other_project")]) {
      await saveParagraphAudioCandidates({ config, candidates: candidates.map((candidate) => candidate.projectId === "other_project" ? { ...candidate, candidateId: `foreign_${candidate.candidateId}` } : candidate) });
    }
    const directory = path.join(config.runtimeRoot, "assets", "clips", "app");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "take1_source.wav"), "unchanged-original-pcm");
    await discardAudioCandidate({ config, candidateId: "take1_1", projectId: "project_1", clipId: "voice_b" });
    expect((await listAudioCandidates({ config, projectId: "project_1" })).map((candidate) => candidate.candidateId)).toEqual(["other_take_0", "other_take_1"]);
    expect(await listAudioCandidates({ config, projectId: "other_project" })).toHaveLength(2);
    expect(await readFile(path.join(directory, "take1_source.wav"), "utf8")).toBe("unchanged-original-pcm");
  });
  it("rejects an incomplete or canceled paragraph batch before changing the manifest", async () => {
    const config = await runtime();
    await expect(saveParagraphAudioCandidates({ config, candidates: [take()[0]] })).rejects.toThrow(/完整/);
    const controller = new AbortController(); controller.abort();
    await expect(saveParagraphAudioCandidates({ config, candidates: take(), signal: controller.signal })).rejects.toThrow();
    await expect(readFile(resolveCandidateManifestPath(config))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps capacities, lists and discard independent for identical clip IDs in the two audio workspaces", async () => {
    const config = await runtime();
    const base = makeVoiceCandidateFixture();
    for (let index = 0; index < 12; index++) await saveAudioCandidate({ config, candidate: {
      ...base, candidateId: `short_${index}`, projectId: "project_1", clipId: "voice_a",
    } });
    await expect(ensureAudioCandidateCapacity({ config, projectId: "project_1", clipId: "voice_a" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(ensureAudioCandidateCapacity({ config, projectId: "project_1", clipId: "voice_a", workspaceMode: "paragraph" })).resolves.toBeUndefined();
    for (let index = 0; index < 12; index++) await saveParagraphAudioCandidates({ config, candidates: take(`paragraph_${index}`) });
    expect(await countAudioCandidates({ config, projectId: "project_1", clipId: "voice_a", workspaceMode: "short" })).toBe(12);
    expect(await countAudioCandidates({ config, projectId: "project_1", clipId: "voice_a", workspaceMode: "paragraph" })).toBe(12);
    expect(await listAudioCandidates({ config, projectId: "project_1", clipId: "voice_a", workspaceMode: "short" })).toHaveLength(12);
    expect(await listAudioCandidates({ config, projectId: "project_1", clipId: "voice_a", workspaceMode: "paragraph" })).toHaveLength(12);
    await discardAudioCandidate({ config, candidateId: "paragraph_0_0", projectId: "project_1", clipId: "voice_a" });
    expect(await countAudioCandidates({ config, projectId: "project_1", clipId: "voice_a", workspaceMode: "short" })).toBe(12);
    expect(await countAudioCandidates({ config, projectId: "project_1", clipId: "voice_a", workspaceMode: "paragraph" })).toBe(11);
  });
});
