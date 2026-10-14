import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { AudioCandidateManifestSchema, AudioCandidateSchema, getAudioCandidateWorkspaceMode, type AudioCandidate, type AudioCandidateManifest, type AudioCandidateWorkspaceMode } from "./audio-candidate";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { getVoiceParagraphReviewClipIds, VoiceParagraphResultSchema } from "./voice-paragraph-result";

export const MAX_UNACCEPTED_CANDIDATES_PER_CLIP = 12;
export class CandidateCapacityError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("此片段已有 12 个候选，请先放弃不需要的候选。");
    this.name = "CandidateCapacityError";
  }
}
export class CandidateSourceChangedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("原候选状态已改变，请刷新列表。");
    this.name = "CandidateSourceChangedError";
  }
}
type CandidateStoreConfig = Pick<LocalRuntimeConfig, "runtimeRoot">;
type CandidateOwnerInput = { config: CandidateStoreConfig; projectId: string; clipId: string; adoptedAssetId?: string; workspaceMode?: AudioCandidateWorkspaceMode };

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function assertCandidateId(candidateId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(candidateId)) throw new Error("Invalid candidate id");
}

async function retryFilesystemAccess<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 1_000;
  while (true) {
    try { return await operation(); }
    catch (error) {
      // Windows may briefly deny rename/unlink while another worker finishes
      // reading the same file. Retain ownership while those handles close.
      if (Date.now() >= deadline || (!hasCode(error, "EPERM") && !hasCode(error, "EBUSY") && !hasCode(error, "EACCES"))) throw error;
      await delay(20);
    }
  }
}

export function resolveCandidateManifestPath(config: CandidateStoreConfig): string {
  return path.join(config.runtimeRoot, "assets", "candidates", "voxcpm2-v1", "manifest.json");
}

async function readManifest(config: CandidateStoreConfig): Promise<AudioCandidateManifest> {
  let contents: string;
  try {
    contents = await retryFilesystemAccess(() => readFile(resolveCandidateManifestPath(config), "utf8"));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return { format: "voxcpm2-product-candidates", version: 1, candidates: [] };
    throw error;
  }
  try {
    return AudioCandidateManifestSchema.parse(JSON.parse(contents));
  } catch {
    // Old prototype records are never interpreted or rewritten as product data.
    throw new Error("候选记录格式不兼容或已损坏，请检查本地候选存储。");
  }
}

async function writeManifest(config: CandidateStoreConfig, manifest: AudioCandidateManifest, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const parsed = AudioCandidateManifestSchema.parse(manifest);
  const target = resolveCandidateManifestPath(config);
  const temporary = path.join(path.dirname(target), `.manifest-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(parsed, null, 2), { encoding: "utf8", flag: "wx" });
    await retryFilesystemAccess(() => { signal?.throwIfAborted(); return rename(temporary, target); });
  } finally {
    await retryFilesystemAccess(() => unlink(temporary)).catch((error) => { if (!hasCode(error, "ENOENT")) throw error; });
  }
}

async function removeEmptyLockDirectory(lockPath: string): Promise<void> {
  await retryFilesystemAccess(() => rmdir(lockPath)).catch((error) => {
    if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTEMPTY") && !hasCode(error, "EEXIST")) throw error;
  });
}

async function removeAbandonedLock(lockPath: string): Promise<void> {
  try {
    const files = await readdir(lockPath);
    if (files.length === 0) {
      await removeEmptyLockDirectory(lockPath);
      return;
    }
    if (files.length !== 1 || !/^[a-f0-9-]+\.owner$/.test(files[0])) return;
    const ownerPath = path.join(lockPath, files[0]);
    const text = await readFile(ownerPath, "utf8");
    let owner: { pid?: unknown };
    try { owner = JSON.parse(text); } catch { owner = {}; }
    if (typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
        return;
      } catch (error) {
        if (!hasCode(error, "ESRCH")) return;
      }
    } else return;
    // The unique owner filename prevents a second stale-lock cleaner from
    // removing a newly acquired lock at the same directory path.
    await retryFilesystemAccess(() => unlink(ownerPath));
    await removeEmptyLockDirectory(lockPath);
  } catch (error) {
    // Windows can report a sharing failure when this directory/owner is being
    // removed by another worker. Unknown ownership is busy, never permission to
    // remove a lock. The acquisition loop bounds its retries independently.
    if (!hasCode(error, "ENOENT") && !hasCode(error, "EPERM") && !hasCode(error, "EBUSY") && !hasCode(error, "EACCES")) throw error;
  }
}

async function withManifestLock<T>(config: CandidateStoreConfig, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const manifest = resolveCandidateManifestPath(config);
  const lockPath = path.join(path.dirname(manifest), ".manifest.lock");
  await mkdir(path.dirname(manifest), { recursive: true });
  const token = randomUUID();
  const preparedPath = path.join(path.dirname(manifest), `.manifest-lock-${token}`);
  const ownerName = `${token}.owner`;
  await mkdir(preparedPath);
  await writeFile(path.join(preparedPath, ownerName), JSON.stringify({ pid: process.pid }), { flag: "wx" });
  const deadline = Date.now() + 5_000;
  let acquired = false;
  try {
    while (!acquired) {
      signal?.throwIfAborted();
      try {
        // Publish the directory and its owner together; an active lock is never
        // temporarily ownerless during acquisition, even across worker processes.
        await rename(preparedPath, lockPath);
        acquired = true;
      } catch (error) {
        if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTEMPTY") && !hasCode(error, "EPERM") && !hasCode(error, "EACCES")) throw error;
        await removeAbandonedLock(lockPath);
        if (Date.now() >= deadline) throw new Error("候选记录正忙，请稍后重试。");
        await delay(20);
      }
    }
    signal?.throwIfAborted();
    return await action();
  } finally {
    const directory = acquired ? lockPath : preparedPath;
    await retryFilesystemAccess(() => unlink(path.join(directory, ownerName))).catch((error) => { if (!hasCode(error, "ENOENT")) throw error; });
    await removeEmptyLockDirectory(directory);
  }
}

function countReady(manifest: AudioCandidateManifest, input: Omit<CandidateOwnerInput, "config">): number {
  return manifest.candidates.filter((candidate) =>
    candidate.projectId === input.projectId && candidate.clipId === input.clipId &&
    getAudioCandidateWorkspaceMode(candidate) === (input.workspaceMode ?? "short") &&
    candidate.status === "ready" && candidate.asset.assetId !== input.adoptedAssetId,
  ).length;
}

function assertCapacity(manifest: AudioCandidateManifest, input: Omit<CandidateOwnerInput, "config">): void {
  if (countReady(manifest, input) >= MAX_UNACCEPTED_CANDIDATES_PER_CLIP) {
    throw new CandidateCapacityError();
  }
}

export async function countAudioCandidates(input: CandidateOwnerInput): Promise<number> {
  return countReady(await readManifest(input.config), input);
}

export async function ensureAudioCandidateCapacity(input: CandidateOwnerInput): Promise<void> {
  assertCapacity(await readManifest(input.config), input);
}

export async function saveAudioCandidate({ config, candidate: inputCandidate, adoptedAssetId, signal, sourceCandidate }: {
  config: CandidateStoreConfig;
  candidate: AudioCandidate;
  adoptedAssetId?: string;
  signal?: AbortSignal;
  sourceCandidate?: AudioCandidate;
}): Promise<AudioCandidate> {
  const candidate = AudioCandidateSchema.parse(inputCandidate);
  return withManifestLock(config, async () => {
    const manifest = await readManifest(config);
    const existing = manifest.candidates.find((item) => item.candidateId === candidate.candidateId);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(candidate)) return existing;
      throw new Error("此候选编号已存在，无法覆盖。");
    }
    if (sourceCandidate && (sourceCandidate.status !== "ready" || sourceCandidate.projectId !== candidate.projectId
      || sourceCandidate.clipId !== candidate.clipId || !isDeepStrictEqual(manifest.candidates.find((item) => item.candidateId === sourceCandidate.candidateId), sourceCandidate))) {
      throw new CandidateSourceChangedError();
    }
    if (candidate.status === "ready") assertCapacity(manifest, { projectId: candidate.projectId, clipId: candidate.clipId, adoptedAssetId,
      workspaceMode: getAudioCandidateWorkspaceMode(candidate) });
    await writeManifest(config, { ...manifest, candidates: [...manifest.candidates, candidate] }, signal);
    return candidate;
  }, signal);
}

/** Publish a paragraph take as one manifest revision, never a partial set. */
export async function saveParagraphAudioCandidates({ config, candidates: inputCandidates, adoptedAssetIds = {}, signal, sourceCandidate }: {
  config: CandidateStoreConfig; candidates: AudioCandidate[]; adoptedAssetIds?: Record<string, string | undefined>; signal?: AbortSignal;
  sourceCandidate?: AudioCandidate;
}): Promise<AudioCandidate[]> {
  const candidates = inputCandidates.map((candidate) => AudioCandidateSchema.parse(candidate));
  const first = candidates[0];
  const paragraph = first?.provenance.paragraph;
  if (!paragraph || new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length
      || candidates.some((candidate) => candidate.status !== "ready" || candidate.projectId !== first.projectId
        || !isDeepStrictEqual(candidate.provenance.paragraph, paragraph))
      || (paragraph.checkStatus !== "review" && (candidates.length !== paragraph.clipIds.length
        || paragraph.clipIds.some((clipId) => candidates.filter((candidate) => candidate.clipId === clipId).length !== 1)))
      || (paragraph.checkStatus === "review" && candidates.length !== 1)) throw new Error("整段候选必须完整且对应同一次生成。");
  return withManifestLock(config, async () => {
    const manifest = await readManifest(config);
    if (sourceCandidate && (sourceCandidate.status !== "ready" || sourceCandidate.projectId !== first.projectId
      || sourceCandidate.provenance.generationMode !== "paragraph"
      || sourceCandidate.provenance.paragraph?.groupId !== paragraph.groupId
      || sourceCandidate.provenance.paragraph.text !== paragraph.text
      || !isDeepStrictEqual(sourceCandidate.provenance.paragraph.clipIds, paragraph.clipIds)
      || !isDeepStrictEqual(sourceCandidate.provenance.paragraph.sourceAsset, paragraph.sourceAsset)
      || !candidates.some((candidate) => candidate.clipId === sourceCandidate.clipId
        && candidate.sourceFingerprint === sourceCandidate.sourceFingerprint)
      || !isDeepStrictEqual(manifest.candidates.find((candidate) => candidate.candidateId === sourceCandidate.candidateId), sourceCandidate))) {
      throw new CandidateSourceChangedError();
    }
    const additions: AudioCandidate[] = [];
    for (const candidate of candidates) {
      const existing = manifest.candidates.find((item) => item.candidateId === candidate.candidateId);
      if (existing) {
        if (!isDeepStrictEqual(existing, candidate)) throw new Error("此候选编号已存在，无法覆盖。");
      } else {
        assertCapacity({ ...manifest, candidates: [...manifest.candidates, ...additions] }, { projectId: candidate.projectId, clipId: candidate.clipId,
          adoptedAssetId: adoptedAssetIds[candidate.clipId], workspaceMode: "paragraph" });
        additions.push(candidate);
      }
    }
    if (additions.length) await writeManifest(config, { ...manifest, candidates: [...manifest.candidates, ...additions] }, signal);
    return candidates;
  }, signal);
}

export async function listAudioCandidates({ config, projectId, clipId, includeDiscarded = false, workspaceMode }: {
  config: CandidateStoreConfig; projectId: string; clipId?: string; includeDiscarded?: boolean; workspaceMode?: AudioCandidateWorkspaceMode;
}): Promise<AudioCandidate[]> {
  return (await readManifest(config)).candidates.filter((candidate) =>
    candidate.projectId === projectId && (clipId === undefined || candidate.clipId === clipId) && (includeDiscarded || candidate.status === "ready")
    && (workspaceMode === undefined || getAudioCandidateWorkspaceMode(candidate) === workspaceMode),
  ).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.candidateId.localeCompare(right.candidateId));
}

/** Add one human listening receipt to the complete safe take in a single revision. */
export async function confirmParagraphAudioCandidates({ config, sourceCandidate, sourceCandidates, confirmedClipIds, confirmedAt, signal }: {
  config: CandidateStoreConfig; sourceCandidate: AudioCandidate; sourceCandidates: AudioCandidate[]; confirmedClipIds: string[]; confirmedAt: string; signal?: AbortSignal;
}): Promise<AudioCandidate[]> {
  const parsed = AudioCandidateSchema.parse(sourceCandidate);
  const paragraph = parsed.provenance.paragraph;
  if (parsed.status !== "ready" || !paragraph || paragraph.checkStatus !== "needs_confirmation"
    || sourceCandidates.length !== paragraph.clipIds.length
    || paragraph.clipIds.some((clipId, index) => sourceCandidates[index]?.clipId !== clipId || sourceCandidates[index]?.status !== "ready"
      || sourceCandidates[index]?.projectId !== parsed.projectId || !isDeepStrictEqual(sourceCandidates[index]?.provenance.paragraph, paragraph))
    || !sourceCandidates.some((item) => isDeepStrictEqual(item, parsed))
    || JSON.stringify(confirmedClipIds) !== JSON.stringify(getVoiceParagraphReviewClipIds(paragraph))) {
    throw new CandidateSourceChangedError();
  }
  return withManifestLock(config, async () => {
    const manifest = await readManifest(config);
    if (!isDeepStrictEqual(manifest.candidates.find((item) => item.candidateId === parsed.candidateId), parsed)) throw new CandidateSourceChangedError();
    if (sourceCandidates.some((item) => !isDeepStrictEqual(manifest.candidates.find((saved) => saved.candidateId === item.candidateId), item))) throw new CandidateSourceChangedError();
    const siblings = manifest.candidates.filter((item) => item.projectId === parsed.projectId
      && isDeepStrictEqual(item.provenance.paragraph, paragraph));
    if (siblings.length !== paragraph.clipIds.length || siblings.some((item) => item.status !== "ready")
      || paragraph.clipIds.some((clipId) => siblings.filter((item) => item.clipId === clipId).length !== 1)
      || !siblings.some((item) => item.candidateId === parsed.candidateId)
      || (paragraph.manualTextConfirmation && !siblings.some((item) => item.candidateId === paragraph.manualTextConfirmation?.sourceCandidateId))) {
      throw new CandidateSourceChangedError();
    }
    const ordered = paragraph.clipIds.map((clipId) => siblings.find((item) => item.clipId === clipId)!);
    if (paragraph.manualTextConfirmation) return ordered;
    const confirmedParagraph = VoiceParagraphResultSchema.parse({ ...paragraph, manualTextConfirmation: {
      sourceCandidateId: parsed.candidateId, confirmedClipIds, confirmedAt,
    } });
    const confirmed = ordered.map((item) => AudioCandidateSchema.parse({ ...item,
      provenance: { ...item.provenance, paragraph: confirmedParagraph } }));
    const updated = new Map(confirmed.map((item) => [item.candidateId, item]));
    await writeManifest(config, { ...manifest, candidates: manifest.candidates.map((item) => updated.get(item.candidateId) ?? item) }, signal);
    return confirmed;
  }, signal);
}

export async function getAudioCandidate({ config, candidateId }: {
  config: CandidateStoreConfig; candidateId: string;
}): Promise<AudioCandidate | null> {
  assertCandidateId(candidateId);
  return (await readManifest(config)).candidates.find((candidate) => candidate.candidateId === candidateId) ?? null;
}

export async function discardAudioCandidate({ config, candidateId, projectId, clipId }: {
  config: CandidateStoreConfig; candidateId: string; projectId: string; clipId: string;
}): Promise<AudioCandidate> {
  assertCandidateId(candidateId);
  return withManifestLock(config, async () => {
    const manifest = await readManifest(config);
    const candidate = manifest.candidates.find((item) => item.candidateId === candidateId);
    if (!candidate) throw new Error("找不到此音频候选。");
    if (candidate.projectId !== projectId || candidate.clipId !== clipId) throw new Error("此候选不属于所选工程或所属片段。");
    const discarded: AudioCandidate = { ...candidate, status: "discarded" };
    const paragraph = candidate.provenance.paragraph;
    const sameTake = (item: AudioCandidate) => item.candidateId === candidateId || Boolean(paragraph
      && item.projectId === candidate.projectId && item.provenance.paragraph?.groupId === paragraph.groupId
      && item.provenance.paragraph.sourceAsset.assetId === paragraph.sourceAsset.assetId);
    await writeManifest(config, { ...manifest, candidates: manifest.candidates.map((item) => sameTake(item) ? { ...item, status: "discarded" as const } : item) });
    // WAVs remain in the shared clip store; projects and revisions may refer to them.
    return discarded;
  });
}
