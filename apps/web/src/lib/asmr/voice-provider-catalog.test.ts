import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { getVoiceProviderCatalog } from "./voice-provider-catalog";

describe("voice provider catalog", () => {
  it("returns safe unavailable providers without revealing filesystem failures", async () => {
    const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: "private-root-does-not-exist" });
    const catalog = await getVoiceProviderCatalog(config);
    expect(catalog.providers.map((item) => [item.id, item.available])).toEqual([["gpt-sovits", false], ["voxcpm2", false]]);
    expect(JSON.stringify(catalog)).not.toContain("private-root");
  });
  it("exposes only authorized reference IDs, names and supported modes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voxcpm-catalog-"));
    for (const name of ["private-cli.exe", "base.gguf", "acoustic.gguf", "reference.wav"]) await writeFile(path.join(root, name), "fixture");
    await writeFile(path.join(root, "transcript.txt"), "你好。\n");
    const profilePath = path.join(root, "profile.json");
    const ref = { id: "soft", displayName: "温柔", audioPath: "reference.wav", promptTextPath: "transcript.txt", licenseStatus: "user_confirmed", consentConfirmedAt: "2026-07-01T00:00:00Z" };
    await writeFile(profilePath, JSON.stringify({ version: 1, provider: "voxcpm2", cliPath: "private-cli.exe", baseModelPath: "base.gguf", acousticModelPath: "acoustic.gguf", defaultReferenceId: "soft", references: [ref, { ...ref, id: "normal", displayName: "普通", promptTextPath: null }] }));
    const catalog = await getVoiceProviderCatalog(getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root, ASMR_VOXCPM2_PROFILE_PATH: profilePath }));
    expect(catalog.providers[1]).toMatchObject({ id: "voxcpm2", label: "VoxCPM2", available: true, defaultReferenceId: "soft", longText: { available: true, reason: expect.stringContaining("仍可生成") }, references: [{ id: "soft", label: "温柔", referenceModes: ["reference_only", "with_reference_text"] }, { id: "normal", label: "普通", referenceModes: ["reference_only"] }] });
    expect(JSON.stringify(catalog)).not.toContain(root);
    expect(JSON.stringify(catalog)).not.toContain("private-cli");
    expect(JSON.stringify(catalog)).not.toContain("你好");
  });
});
