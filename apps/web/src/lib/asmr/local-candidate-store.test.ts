import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import * as fileSystem from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { AudioCandidate } from "./audio-candidate";
import { CandidateCapacityError, countAudioCandidates, discardAudioCandidate, ensureAudioCandidateCapacity, getAudioCandidate, listAudioCandidates, resolveCandidateManifestPath, saveAudioCandidate } from "./local-candidate-store";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, unlink: vi.fn(actual.unlink), readFile: vi.fn(actual.readFile) };
});

async function config() { return { runtimeRoot: await mkdtemp(path.join(os.tmpdir(), "asmr-vox-candidates-")) }; }
function candidate(id = "candidate_1", clipId = "voice_1", projectId = "project_1"): AudioCandidate {
  return {
    version: 1, candidateId: id, projectId, clipId, sourceFingerprint: "source", requestFingerprint: "request",
    asset: { assetId: id, uri: `asset://clip/${id}`, duration: 3 },
    wav: { sampleRate: 48000, channels: 1, bitsPerSample: 16 },
    provenance: { provider: "voxcpm2", model: "VoxCPM2", seed: 42, temperature: 1, voicePackId: "soft_zh", referenceMode: "reference_only", generationMode: "clip", parameters: {} },
    createdAt: "2026-09-08T00:00:00.000Z", qualityWarnings: [], status: "ready",
  };
}

describe("product candidate store", () => {
  it("cancels a save waiting for another manifest owner without publishing the candidate", async () => {
    const runtime = await config();
    const manifest = resolveCandidateManifestPath(runtime);
    const lock = path.join(path.dirname(manifest), ".manifest.lock");
    const owner = path.join(lock, "deadbeef.owner");
    await mkdir(lock, { recursive: true });
    await writeFile(owner, JSON.stringify({ pid: process.pid }));
    const controller = new AbortController();
    const originalRead = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).readFile;
    const reader = vi.mocked(fileSystem.readFile).mockImplementation(async (...args: Parameters<typeof originalRead>) => {
      if (String(args[0]) === owner) controller.abort();
      return originalRead(...args);
    });
    try {
      await expect(saveAudioCandidate({ config: runtime, candidate: candidate(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
      await expect(originalRead(manifest, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.parse(await originalRead(owner, "utf8"))).toEqual({ pid: process.pid });
      expect(await fileSystem.readdir(path.dirname(manifest))).toEqual([".manifest.lock"]);
    } finally { reader.mockImplementation(originalRead); }
  });

  it("persists independent manifests and recovers project/clip ownership from disk", async () => {
    const runtime = await config();
    expect(resolveCandidateManifestPath(runtime)).toBe(path.join(runtime.runtimeRoot, "assets", "candidates", "voxcpm2-v1", "manifest.json"));
    await saveAudioCandidate({ config: runtime, candidate: candidate() });
    await saveAudioCandidate({ config: runtime, candidate: candidate("candidate_2", "other_voice") });
    await saveAudioCandidate({ config: runtime, candidate: candidate("candidate_3", "voice_1", "other_project") });
    expect(await listAudioCandidates({ config: { ...runtime }, projectId: "project_1", clipId: "voice_1" })).toEqual([candidate()]);
    expect(await getAudioCandidate({ config: runtime, candidateId: "candidate_2" })).toEqual(candidate("candidate_2", "other_voice"));
    await expect(getAudioCandidate({ config: runtime, candidateId: "../manifest" })).rejects.toThrow(/id/);
  });

  it("discards only the matching owner's manifest entry and preserves every WAV", async () => {
    const runtime = await config();
    const wavDirectory = path.join(runtime.runtimeRoot, "assets", "clips", "app");
    await mkdir(wavDirectory, { recursive: true });
    const wavPath = path.join(wavDirectory, "candidate_1.wav");
    await writeFile(wavPath, "saved-audio");
    await saveAudioCandidate({ config: runtime, candidate: candidate() });
    await expect(discardAudioCandidate({ config: runtime, candidateId: "candidate_1", projectId: "foreign", clipId: "voice_1" })).rejects.toThrow(/所属/);
    await discardAudioCandidate({ config: runtime, candidateId: "candidate_1", projectId: "project_1", clipId: "voice_1" });
    expect(await listAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1" })).toEqual([]);
    expect((await listAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1", includeDiscarded: true }))[0].status).toBe("discarded");
    expect(await readFile(wavPath, "utf8")).toBe("saved-audio");
  });

  it("lists ready candidates across one project's clips in stable newest-first order without changing the manifest", async () => {
    const runtime = await config();
    const records = [
      candidate("older", "voice_1"),
      { ...candidate("newer_b", "voice_1"), createdAt: "2026-09-09T00:00:00.000Z" },
      { ...candidate("newer_a", "voice_2"), createdAt: "2026-09-09T00:00:00.000Z" },
      { ...candidate("discarded", "voice_2"), status: "discarded" as const, createdAt: "2026-09-10T00:00:00.000Z" },
      candidate("foreign", "voice_1", "project_10"),
    ];
    for (const record of records) await saveAudioCandidate({ config: runtime, candidate: record });
    const manifestPath = resolveCandidateManifestPath(runtime);
    const before = await readFile(manifestPath, "utf8");

    expect((await listAudioCandidates({ config: runtime, projectId: "project_1" })).map((item) => item.candidateId)).toEqual(["newer_a", "newer_b", "older"]);
    expect((await listAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1" })).map((item) => item.candidateId)).toEqual(["newer_b", "older"]);
    expect((await listAudioCandidates({ config: runtime, projectId: "project_1", includeDiscarded: true })).map((item) => item.candidateId)).toEqual(["discarded", "newer_a", "newer_b", "older"]);
    expect(await listAudioCandidates({ config: runtime, projectId: "unknown_project" })).toEqual([]);
    expect(await listAudioCandidates({ config: runtime, projectId: "project_1", clipId: "" })).toEqual([]);
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  it("enforces 12 unadopted candidates under concurrent saves without losing updates", async () => {
    const runtime = await config();
    const outcomes = await Promise.allSettled(Array.from({ length: 15 }, (_, index) => saveAudioCandidate({ config: runtime, candidate: candidate(`c_${index}`) })));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(12);
    expect(await countAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1" })).toBe(12);
    await expect(ensureAudioCandidateCapacity({ config: runtime, projectId: "project_1", clipId: "voice_1" })).rejects.toThrow(/12/);
    await expect(ensureAudioCandidateCapacity({ config: runtime, projectId: "project_1", clipId: "voice_1" })).rejects.toBeInstanceOf(CandidateCapacityError);
    const first = (await listAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1" }))[0];
    await saveAudioCandidate({ config: runtime, candidate: candidate("extra"), adoptedAssetId: first.asset.assetId });
    expect(await countAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1", adoptedAssetId: first.asset.assetId })).toBe(12);
    await discardAudioCandidate({ config: runtime, candidateId: "extra", projectId: "project_1", clipId: "voice_1" });
    await expect(ensureAudioCandidateCapacity({ config: runtime, projectId: "project_1", clipId: "voice_1", adoptedAssetId: first.asset.assetId })).resolves.toBeUndefined();
  });

  it("treats candidate IDs as immutable and permits identical save retries", async () => {
    const runtime = await config();
    await saveAudioCandidate({ config: runtime, candidate: candidate() });
    await expect(saveAudioCandidate({ config: runtime, candidate: candidate() })).resolves.toEqual(candidate());
    await expect(saveAudioCandidate({ config: runtime, candidate: { ...candidate(), projectId: "foreign" } })).rejects.toThrow(/已存在/);
    expect((await getAudioCandidate({ config: runtime, candidateId: "candidate_1" }))?.projectId).toBe("project_1");
  });

  it("recovers a departed worker's lock without allowing concurrent writers to remove its replacement", async () => {
    const runtime = await config();
    const exitedWorker = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { windowsHide: true });
    const lock = path.join(path.dirname(resolveCandidateManifestPath(runtime)), ".manifest.lock");
    await mkdir(lock, { recursive: true });
    await writeFile(path.join(lock, "deadbeef.owner"), JSON.stringify({ pid: Number(exitedWorker.stdout) }));
    await Promise.all(Array.from({ length: 5 }, (_, index) => saveAudioCandidate({ config: runtime, candidate: candidate(`recovered_${index}`) })));
    expect(await countAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1" })).toBe(5);
  });

  it("retries transient Windows owner-file sharing failures before releasing its lock", async () => {
    const runtime = await config();
    const originalUnlink = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).unlink;
    let denied = false;
    const unlink = vi.mocked(fileSystem.unlink).mockImplementation(async (target) => {
      if (!denied && String(target).endsWith(".owner")) {
        denied = true;
        throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
      }
      return originalUnlink(target);
    });
    try {
      await saveAudioCandidate({ config: runtime, candidate: candidate() });
      expect(denied).toBe(true);
      await saveAudioCandidate({ config: runtime, candidate: candidate("second") });
      expect(await countAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1" })).toBe(2);
    } finally { unlink.mockImplementation(originalUnlink); }
  });

  it("treats an unreadable Windows owner as busy until its identity can be read safely", async () => {
    const runtime = await config();
    const exitedWorker = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { windowsHide: true });
    const lock = path.join(path.dirname(resolveCandidateManifestPath(runtime)), ".manifest.lock");
    const owner = path.join(lock, "deadbeef.owner");
    await mkdir(lock, { recursive: true });
    await writeFile(owner, JSON.stringify({ pid: Number(exitedWorker.stdout) }));
    const reader = vi.mocked(fileSystem.readFile);
    reader.mockClear();
    reader.mockRejectedValueOnce(Object.assign(new Error("delete pending"), { code: "EPERM" }));

    await expect(saveAudioCandidate({ config: runtime, candidate: candidate() })).resolves.toEqual(candidate());
    const ownerReads = reader.mock.calls.filter(([target]) => String(target) === owner);
    // The first failure alone must never authorize deleting the unknown lock.
    expect(ownerReads.length).toBeGreaterThanOrEqual(2);
    expect(reader.mock.calls[0][0]).toBe(owner);
    expect(await countAudioCandidates({ config: runtime, projectId: "project_1", clipId: "voice_1" })).toBe(1);
  });

  it.each(["legacy", "corrupt"])("does not overwrite a %s manifest", async (kind) => {
    const runtime = await config();
    const target = resolveCandidateManifestPath(runtime);
    await mkdir(path.dirname(target), { recursive: true });
    const original = kind === "legacy" ? JSON.stringify({ version: 1, candidates: [] }) : "{broken";
    await writeFile(target, original);
    await expect(saveAudioCandidate({ config: runtime, candidate: candidate() })).rejects.toThrow(/候选记录/);
    expect(await readFile(target, "utf8")).toBe(original);
  });
});
