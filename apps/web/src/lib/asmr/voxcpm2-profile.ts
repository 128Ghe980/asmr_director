import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const ReferenceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const ProfileFile = z.object({
  version: z.literal(1),
  provider: z.literal("voxcpm2"),
  cliPath: z.string().min(1),
  baseModelPath: z.string().min(1),
  acousticModelPath: z.string().min(1),
  defaultReferenceId: ReferenceId,
  references: z.array(z.object({
    id: ReferenceId,
    displayName: z.string().min(1).max(100),
    audioPath: z.string().min(1),
    promptTextPath: z.string().min(1).nullish(),
    licenseStatus: z.literal("user_confirmed"),
    consentConfirmedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
    durationSeconds: z.number().positive().optional(),
  }).passthrough()).min(1).max(40),
}).passthrough();

/** Validate without stripping server provenance or future profile metadata. */
export function parseVoxCpm2ProfileFile(value: unknown) {
  const file = ProfileFile.parse(value);
  const ids = new Set(file.references.map((item) => item.id));
  if (ids.size !== file.references.length || !ids.has(file.defaultReferenceId)) throw new Error("Invalid references");
  return file;
}

export type VoxCpm2Reference = {
  id: string;
  displayName: string;
  audioPath: string;
  promptText: string | null;
  durationSeconds?: number;
};

export type VoxCpm2Profile = {
  manifestPath: string;
  cliPath: string;
  baseModelPath: string;
  acousticModelPath: string;
  defaultReferenceId: string;
  references: VoxCpm2Reference[];
};

export function normalizeVoxCpm2Transcript(value: string): string | null {
  const words = value.replace(/\p{P}/gu, " ").replace(/\s+/gu, " ").trim();
  return words ? `${words} ` : null;
}

export function selectVoxCpm2Reference(profile: VoxCpm2Profile, id = profile.defaultReferenceId): VoxCpm2Reference {
  const reference = profile.references.find((item) => item.id === id);
  if (!reference) throw new Error("参考声音不可用，请重新选择。");
  return reference;
}

async function assertFile(filePath: string) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size === 0) throw new Error("Missing runtime file");
}

export async function loadVoxCpm2Profile(manifestPath: string): Promise<VoxCpm2Profile> {
  try {
    const resolved = path.resolve(manifestPath);
    const root = path.dirname(resolved);
    const raw = await readFile(resolved, "utf8");
    if (raw.length > 100_000) throw new Error("Profile too large");
    const file = parseVoxCpm2ProfileFile(JSON.parse(raw));
    const profile: VoxCpm2Profile = {
      manifestPath: resolved,
      cliPath: path.resolve(root, file.cliPath),
      baseModelPath: path.resolve(root, file.baseModelPath),
      acousticModelPath: path.resolve(root, file.acousticModelPath),
      defaultReferenceId: file.defaultReferenceId,
      references: [],
    };
    await Promise.all([profile.cliPath, profile.baseModelPath, profile.acousticModelPath].map(assertFile));
    for (const ref of file.references) {
      const audioPath = path.resolve(root, ref.audioPath);
      await assertFile(audioPath);
      const rawTranscript = ref.promptTextPath ? await readFile(path.resolve(root, ref.promptTextPath), "utf8") : "";
      if (rawTranscript.length > 20_000) throw new Error("Transcript too large");
      profile.references.push({ id: ref.id, displayName: ref.displayName, audioPath, promptText: normalizeVoxCpm2Transcript(rawTranscript), ...(ref.durationSeconds ? { durationSeconds: ref.durationSeconds } : {}) });
    }
    return profile;
  } catch {
    throw new Error("VoxCPM2 配置不可用，请检查本机模型与参考声音配置。");
  }
}
