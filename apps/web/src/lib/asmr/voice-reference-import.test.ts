import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { decodePcmWav, writePcm16Wav } from "./pcm-audio";
import { getVoiceProviderCatalog } from "./voice-provider-catalog";
import { importVoiceReference, MAX_VOICE_REFERENCE_BYTES, readVoiceReferenceAudio, type VoiceReferenceImportInput, type VoiceReferenceSpawn } from "./voice-reference-import";

const fileSystem = vi.hoisted(() => ({ failLockCleanup: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, unlink: async (file: Parameters<typeof real.unlink>[0]) => {
    if (fileSystem.failLockCleanup && String(file).endsWith(".reference-import.lock")) throw new Error("simulated lock cleanup failure");
    return real.unlink(file);
  } };
});

const wav = (seconds = 2, silent = false, rate = 16000, channels: 1 | 2 = 1) => writePcm16Wav(new Float32Array(seconds * rate * channels).fill(silent ? 0 : .125), rate, channels);
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "voice-reference-"));
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root, ASMR_VOICE_REFERENCE_ROOT: path.join(root, "imports"), ASMR_VOICE_REFERENCE_FFMPEG: "private-native-ffmpeg.exe" });
  const manifestPath = path.join(root, "profile.json"); config.voxcpm2ProfilePath = manifestPath;
  for (const name of ["cli.exe", "base.gguf", "acoustic.gguf"]) await writeFile(path.join(root, name), "fixture");
  await writeFile(path.join(root, "old.wav"), wav());
  const reference = { id: "old", displayName: "原有", audioPath: "old.wav", promptTextPath: null, licenseStatus: "user_confirmed", consentConfirmedAt: "2026-10-01T00:00:00Z", customReference: { keep: true } };
  const manifest = { version: 1, provider: "voxcpm2", cliPath: "cli.exe", baseModelPath: "base.gguf", acousticModelPath: "acoustic.gguf", defaultReferenceId: "old", references: [reference], customProfile: { untouched: true } };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const original = await readFile(manifestPath, "utf8");
  const input: VoiceReferenceImportInput = { bytes: new Uint8Array([1, 2, 3]), filename: "../../private-source.mp3", name: "新声音", startSeconds: 4, durationSeconds: 2, config };
  return { root, config, manifestPath, manifest, reference, original, input };
}

function nativeFixture(mode: "valid" | "short" | "silent" | "wrong-rate" | "invalid" | "failed" | "hang" | "spawn-error" = "valid") {
  const killed = vi.fn(), children: EventEmitter[] = [];
  const spawnImpl = vi.fn<VoiceReferenceSpawn>((_command, args) => {
    const child = new EventEmitter() as EventEmitter & { pid?: number; stderr: PassThrough; kill: typeof killed };
    child.pid = mode === "spawn-error" ? undefined : 123; child.stderr = new PassThrough();
    child.kill = killed.mockImplementation(() => { setTimeout(() => child.emit("close", null), 0); });
    children.push(child);
    setTimeout(() => { void (async () => {
      if (mode === "hang") return;
      if (mode === "spawn-error") { child.emit("error", new Error("private-install-location")); return; }
      if (mode === "failed") { child.stderr.write("private-source-path invalid media"); child.emit("close", 1); return; }
      const seconds = Number(args[args.indexOf("-t") + 1]);
      await writeFile(args.at(-1)!, mode === "invalid" ? "invalid" : wav(mode === "short" ? seconds / 2 : seconds, mode === "silent", mode === "wrong-rate" ? 48000 : 16000));
      child.emit("close", 0);
    })(); }, 0);
    return child;
  });
  return { spawnImpl, killed, children };
}

describe("user reference audio import", () => {
  it("preserves original bytes and metadata, prepares normalized reference-only audio and atomic profile backup", async () => {
    const f = await fixture(), native = nativeFixture();
    const imported = await importVoiceReference(f.input, native);
    expect(imported).toMatchObject({ label: "新声音", referenceModes: ["reference_only"], durationSeconds: 2, audioUrl: `/api/voice-references/${imported.id}/audio` });
    expect(imported.id).toMatch(/^user-[a-f0-9-]+$/);
    const profile = JSON.parse(await readFile(f.manifestPath, "utf8"));
    expect(profile.references[0]).toEqual(f.reference); expect(profile.defaultReferenceId).toBe("old"); expect(profile.customProfile).toEqual({ untouched: true });
    expect(profile.references[1]).toMatchObject({ id: imported.id, promptTextPath: null, licenseStatus: "user_confirmed", durationSeconds: 2 });
    const directory = path.join(f.config.voiceReferenceRoot!, imported.id);
    expect(await readFile(path.join(directory, "source.mp3"))).toEqual(Buffer.from(f.input.bytes));
    const metadata = JSON.parse(await readFile(path.join(directory, "provenance.json"), "utf8"));
    expect(metadata).toMatchObject({ status: "imported", originalFilename: "private-source.mp3", originalBytes: 3, selectedStartSeconds: 4, selectedDurationSeconds: 2, hasUserTranscript: false, normalization: { sampleRate: 16000, channels: 1, format: "PCM16" } });
    expect(metadata.originalSha256).toHaveLength(64); expect(metadata.normalizedSha256).toHaveLength(64);
    expect(await readFile(`${f.manifestPath}.before-reference-${imported.id}.bak`, "utf8")).toBe(f.original);
    const [command, args, options] = native.spawnImpl.mock.calls[0];
    expect(command).toBe("private-native-ffmpeg.exe"); expect(options).toMatchObject({ shell: false, windowsHide: true });
    expect(args).toContain("file,pipe"); expect(args[args.indexOf("-ss") + 1]).toBe("4"); expect(args[args.indexOf("-c:a") + 1]).toBe("pcm_s16le");
    expect(args.join(" ")).not.toContain("private-source.mp3");
    const decoded = decodePcmWav(await readVoiceReferenceAudio(imported.id, f.config));
    expect([decoded.sampleRate, decoded.channels, decoded.samples.length]).toEqual([16000, 1, 32000]);
    const catalog = await getVoiceProviderCatalog(f.config);
    expect(catalog.providers[1].references[1]).toEqual(imported);
    expect(JSON.stringify(catalog)).not.toContain(f.root); expect(JSON.stringify(catalog)).not.toContain("provenance");
    expect(await readFile(path.join(f.root, "old.wav"))).toEqual(Buffer.from(wav()));
  });

  it("preserves supplied actual transcript and exposes both reference modes", async () => {
    const f = await fixture();
    const imported = await importVoiceReference({ ...f.input, promptText: "你好。请坐！" }, nativeFixture());
    expect(imported.referenceModes).toEqual(["reference_only", "with_reference_text"]);
    expect(await readFile(path.join(f.config.voiceReferenceRoot!, imported.id, "reference.txt"), "utf8")).toBe("你好。请坐！\n");
  });

  it("treats punctuation-only optional text as reference-only without inventing transcript", async () => {
    const f = await fixture();
    const imported = await importVoiceReference({ ...f.input, promptText: "……！？" }, nativeFixture());
    expect(imported.referenceModes).toEqual(["reference_only"]);
    expect(JSON.parse(await readFile(f.manifestPath, "utf8")).references[1].promptTextPath).toBeNull();
  });

  it("reports a saved reference as successful when post-commit lock cleanup fails, retaining recovery metadata", async () => {
    const f = await fixture();
    fileSystem.failLockCleanup = true;
    try {
      const imported = await importVoiceReference(f.input, nativeFixture());
      expect(JSON.parse(await readFile(f.manifestPath, "utf8")).references[1].id).toBe(imported.id);
      expect(JSON.parse(await readFile(path.join(f.config.voiceReferenceRoot!, imported.id, "provenance.json"), "utf8"))).toMatchObject({ status: "imported", profileLockCleanupNeeded: true });
      expect(await readVoiceReferenceAudio(imported.id, f.config)).toEqual(wav());
    } finally { fileSystem.failLockCleanup = false; }
  });

  it("serializes concurrent profile appends without losing either reference or unknown metadata", async () => {
    const f = await fixture();
    const results = await Promise.all([importVoiceReference({ ...f.input, name: "甲" }, nativeFixture()), importVoiceReference({ ...f.input, name: "乙" }, nativeFixture())]);
    const profile = JSON.parse(await readFile(f.manifestPath, "utf8"));
    expect(profile.references.map((ref: { id: string }) => ref.id).sort()).toEqual(["old", ...results.map(ref => ref.id)].sort());
    expect(profile.references[0]).toEqual(f.reference); expect(profile.customProfile).toEqual(f.manifest.customProfile);
    const backups = await Promise.all(results.map(result => readFile(`${f.manifestPath}.before-reference-${result.id}.bak`, "utf8").then(JSON.parse)));
    expect(backups.map(item => item.references.length).sort()).toEqual([1, 2]);
    expect((await readdir(f.root)).filter(name => name.endsWith(".tmp") || name.endsWith(".lock"))).toEqual([]);
  });

  it.each(["short", "silent", "wrong-rate", "invalid", "failed", "spawn-error"] as const)("rejects %s conversion, preserving old profile and original uploaded bytes", async mode => {
    const f = await fixture();
    await expect(importVoiceReference(f.input, nativeFixture(mode))).rejects.toThrow(/片段|声音|音频|转换/);
    expect(await readFile(f.manifestPath, "utf8")).toBe(f.original);
    const directories = await readdir(f.config.voiceReferenceRoot!); expect(directories).toHaveLength(1);
    expect(await readFile(path.join(f.config.voiceReferenceRoot!, directories[0], "source.mp3"))).toEqual(Buffer.from(f.input.bytes));
    const metadata = await readFile(path.join(f.config.voiceReferenceRoot!, directories[0], "provenance.json"), "utf8");
    expect(JSON.parse(metadata).status).toBe("failed"); expect(metadata).not.toContain("private-install-location");
  });

  it("kills timed out native conversion, confirms exit and leaves profile unchanged", async () => {
    const f = await fixture(), native = nativeFixture("hang");
    await expect(importVoiceReference(f.input, { ...native, timeoutMs: 10, exitWaitMs: 1000 })).rejects.toMatchObject({ statusCode: 504 });
    expect(native.killed).toHaveBeenCalledWith("SIGKILL"); expect(await readFile(f.manifestPath, "utf8")).toBe(f.original);
  });

  it("cancels a running conversion and preserves the uploaded original without publishing", async () => {
    const f = await fixture(), native = nativeFixture("hang"), controller = new AbortController();
    const pending = importVoiceReference({ ...f.input, signal: controller.signal }, native);
    while (!native.children.length) await new Promise(resolve => setTimeout(resolve, 1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ statusCode: 499 });
    expect(native.killed).toHaveBeenCalledWith("SIGKILL"); expect(await readFile(f.manifestPath, "utf8")).toBe(f.original);
    const directories = await readdir(f.config.voiceReferenceRoot!);
    expect(JSON.parse(await readFile(path.join(f.config.voiceReferenceRoot!, directories[0], "provenance.json"), "utf8")).status).toBe("cancelled");
  });

  it("does not delete or override another writer's lock and does not publish on lock timeout", async () => {
    const f = await fixture();
    await writeFile(`${f.manifestPath}.reference-import.lock`, "other writer");
    await expect(importVoiceReference(f.input, { ...nativeFixture(), lockWaitMs: 1 })).rejects.toMatchObject({ statusCode: 503 });
    expect(await readFile(`${f.manifestPath}.reference-import.lock`, "utf8")).toBe("other writer"); expect(await readFile(f.manifestPath, "utf8")).toBe(f.original);
  });

  it("keeps the old profile when its reference capacity is reached", async () => {
    const f = await fixture();
    const full = JSON.stringify({ ...f.manifest, references: Array.from({ length: 40 }, (_, index) => ({ ...f.reference, id: index ? `old${index}` : "old" })) });
    await writeFile(f.manifestPath, full);
    await expect(importVoiceReference(f.input, nativeFixture())).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(f.manifestPath, "utf8")).toBe(full);
  });

  it.each([
    { filename: "outside.exe" }, { bytes: new Uint8Array() }, { bytes: new Uint8Array(MAX_VOICE_REFERENCE_BYTES + 1) },
    { name: " " }, { name: "bad\u0000name" }, { startSeconds: -1 }, { startSeconds: NaN }, { durationSeconds: 0 }, { durationSeconds: 31 }, { promptText: "x".repeat(2001) },
  ])("rejects invalid import parameters before spawning or changing the profile", async invalid => {
    const f = await fixture(), native = nativeFixture();
    await expect(importVoiceReference({ ...f.input, ...invalid }, native)).rejects.toThrow();
    expect(native.spawnImpl).not.toHaveBeenCalled(); expect(await readFile(f.manifestPath, "utf8")).toBe(f.original);
  });

  it("rejects pre-cancelled requests and unsafe/unknown preview IDs without revealing local paths", async () => {
    const f = await fixture(), native = nativeFixture(), controller = new AbortController(); controller.abort();
    await expect(importVoiceReference({ ...f.input, signal: controller.signal }, native)).rejects.toMatchObject({ statusCode: 499 });
    expect(native.spawnImpl).not.toHaveBeenCalled();
    await expect(readVoiceReferenceAudio("../profile.json", f.config)).rejects.toMatchObject({ statusCode: 400 });
    await expect(readVoiceReferenceAudio("missing", f.config)).rejects.toMatchObject({ statusCode: 404 });
    expect(await readVoiceReferenceAudio("old", f.config)).toEqual(wav());
    await writeFile(path.join(f.root, "old.wav"), "private-corrupt-source");
    await expect(readVoiceReferenceAudio("old", f.config)).rejects.not.toThrow("private-corrupt");
  });
});
