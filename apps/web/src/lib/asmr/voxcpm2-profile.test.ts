import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadVoxCpm2Profile, normalizeVoxCpm2Transcript, selectVoxCpm2Reference } from "./voxcpm2-profile";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "voxcpm-profile-"));
  const manifest = { version: 1, provider: "voxcpm2", cliPath: "cli.exe", baseModelPath: "base.gguf", acousticModelPath: "acoustic.gguf", defaultReferenceId: "soft", references: [{ id: "soft", displayName: "温柔", audioPath: "soft.wav", promptTextPath: "soft.txt", licenseStatus: "user_confirmed", consentConfirmedAt: "2026-07-01T00:00:00Z" }] };
  for (const name of ["cli.exe", "base.gguf", "acoustic.gguf", "soft.wav"]) await writeFile(path.join(root, name), "fixture");
  await writeFile(path.join(root, "soft.txt"), "欢迎光临。请坐，慢慢放松！\r\n");
  const manifestPath = path.join(root, "profile.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, manifest, manifestPath };
}

describe("VoxCPM2 profile", () => {
  it("normalizes punctuation and preserves precisely one trailing ASCII space", () => {
    expect(normalizeVoxCpm2Transcript(" 欢迎。‘请坐’\r\n ")).toBe("欢迎 请坐 ");
    expect(normalizeVoxCpm2Transcript("……")).toBeNull();
  });
  it("loads authorized local references without exposing client paths", async () => {
    const { root, manifestPath } = await fixture();
    const profile = await loadVoxCpm2Profile(manifestPath);
    expect(profile.cliPath).toBe(path.join(root, "cli.exe"));
    expect(selectVoxCpm2Reference(profile).promptText).toBe("欢迎光临 请坐 慢慢放松 ");
    expect(() => selectVoxCpm2Reference(profile, "../outside")).toThrow("参考声音不可用");
  });
  it("allows reference-only mode when no transcript exists", async () => {
    const { manifest, manifestPath } = await fixture();
    await writeFile(manifestPath, JSON.stringify({ ...manifest, references: [{ ...manifest.references[0], promptTextPath: null }] }));
    expect((await loadVoxCpm2Profile(manifestPath)).references[0].promptText).toBeNull();
  });
  it("rejects duplicate, unauthorized, missing runtime and malformed profiles with safe errors", async () => {
    const { manifest, manifestPath } = await fixture();
    for (const invalid of [
      { ...manifest, references: [manifest.references[0], manifest.references[0]] },
      { ...manifest, references: [{ ...manifest.references[0], consentConfirmedAt: null }] },
      { ...manifest, cliPath: "private-missing-engine.exe" },
      { ...manifest, defaultReferenceId: "missing" },
    ]) {
      await writeFile(manifestPath, JSON.stringify(invalid));
      await expect(loadVoxCpm2Profile(manifestPath)).rejects.toThrow("VoxCPM2 配置不可用");
      await expect(loadVoxCpm2Profile(manifestPath)).rejects.not.toThrow("private-missing-engine.exe");
    }
  });
});
