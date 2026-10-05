import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { LocalStorageError } from "./local-storage-error";
import { writePcm16Wav } from "./pcm-audio";
import { MAX_VOICE_REFERENCE_BYTES } from "./voice-reference-import";
import { transcribeVoiceReference, type VoiceReferenceTranscriptionInput, type VoiceReferenceTranscriptionSpawn } from "./voice-reference-transcription";

const wav = (seconds = 2, rate = 16000, silent = false) => writePcm16Wav(new Float32Array(seconds * rate).fill(silent ? 0 : .125), rate, 1);
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "reference-transcription-test-"));
  const config = getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root, ASMR_VOICE_REFERENCE_FFMPEG: "private-ffmpeg.exe" });
  const profile = path.join(root, "profile.json"); await writeFile(profile, "private profile unchanged");
  const input: VoiceReferenceTranscriptionInput = { bytes: new Uint8Array([1, 2, 3]), filename: "private-upload.mp3", startSeconds: 7.5, durationSeconds: 2, language: "zh", config };
  const resolveRuntimeImpl = vi.fn().mockResolvedValue({ pythonPath: "private-python.exe", modelPath: "private-model" });
  return { root, profile, input, resolveRuntimeImpl };
}
type Mode = "valid" | "silent" | "short" | "wrong-rate" | "conversion-error" | "spawn-error" | "hang-conversion" | "hang-asr" | "unconfirmed" | "invalid-json" | "mismatched-language" | "no-speech" | "runtime-error";
function nativeFixture(mode: Mode = "valid", conversionDelay = 0, recognitionDelay = 0, onConversion?: () => void) {
  const children: (EventEmitter & { pid?: number; kill: (signal: NodeJS.Signals) => unknown })[] = [];
  const spawnImpl = vi.fn<VoiceReferenceTranscriptionSpawn>((_command, args) => {
    const conversion = args.includes("-i"), child = new EventEmitter() as typeof children[number];
    child.pid = mode === "spawn-error" ? undefined : 100 + children.length;
    child.kill = vi.fn(() => { if (mode !== "unconfirmed") setTimeout(() => child.emit("close", null), 0); }); children.push(child);
    setTimeout(() => { void (async () => {
      if (mode === "spawn-error") { child.emit("error", new Error("private-path")); return; }
      if (conversion && ["hang-conversion", "unconfirmed"].includes(mode) || !conversion && mode === "hang-asr") return;
      if (conversion) {
        if (mode === "conversion-error") { child.emit("close", 1); return; }
        await writeFile(args.at(-1)!, wav(mode === "short" ? 1 : 2, mode === "wrong-rate" ? 48000 : 16000, mode === "silent"));
        onConversion?.();
      } else {
        const request = JSON.parse(await readFile(args.at(-1)!, "utf8"));
        const result = mode === "no-speech" || mode === "runtime-error" ? { version: 1, success: false, code: mode === "no-speech" ? "no_speech" : "runtime_unavailable" }
          : { version: 1, success: true, transcript: "你好，今天辛苦了。", language: mode === "mismatched-language" ? "en" : request.language };
        await writeFile(request.outputJson, mode === "invalid-json" ? "private-json-invalid" : JSON.stringify(result));
      }
      child.emit("close", 0);
    })(); }, conversion ? conversionDelay : recognitionDelay);
    return child;
  });
  return { spawnImpl, children };
}
const exists = async (file: string) => stat(file).then(() => true, () => false);
async function waitUntil(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error("condition not reached");
}

describe("reference-segment transcription", () => {
  it.each(["zh", "en", "ja", "ko"])("recognizes only the selected segment in %s without publishing profile/assets", async language => {
    const f = await fixture(), native = nativeFixture();
    const result = await transcribeVoiceReference({ ...f.input, language }, { ...native, resolveRuntimeImpl: f.resolveRuntimeImpl });
    expect(result).toEqual({ transcript: "你好，今天辛苦了。", language, startSeconds: 7.5, durationSeconds: 2 });
    expect(await readFile(f.profile, "utf8")).toBe("private profile unchanged");
    expect(await readdir(path.join(f.root, "tmp"))).toEqual([]); expect(await readdir(path.join(f.root, "locks"))).toEqual([]);
    expect(native.spawnImpl).toHaveBeenCalledTimes(2);
    const [command, args, options] = native.spawnImpl.mock.calls[0];
    expect(command).toBe("private-ffmpeg.exe"); expect(args[args.indexOf("-ss") + 1]).toBe("7.5"); expect(args[args.indexOf("-t") + 1]).toBe("2");
    expect(args).toContain("file,pipe"); expect(args.join(" ")).not.toContain("private-upload");
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: "ignore", env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" } });
    expect(native.spawnImpl.mock.calls[1][1][0]).toMatch(/transcribe-voice-reference\.py$/);
  });
  it.each([
    { filename: "voice.exe" }, { bytes: new Uint8Array() }, { bytes: new Uint8Array(MAX_VOICE_REFERENCE_BYTES + 1) },
    { language: "auto" }, { language: "../private" }, { startSeconds: -1 }, { startSeconds: Infinity }, { durationSeconds: 0 }, { durationSeconds: 31 },
  ])("rejects invalid input before spawning or creating scratch", async invalid => {
    const f = await fixture(), native = nativeFixture();
    await expect(transcribeVoiceReference({ ...f.input, ...invalid }, { ...native, resolveRuntimeImpl: f.resolveRuntimeImpl })).rejects.toThrow();
    expect(native.spawnImpl).not.toHaveBeenCalled(); expect(f.resolveRuntimeImpl).not.toHaveBeenCalled(); expect(await exists(path.join(f.root, "tmp"))).toBe(false);
  });
  it.each(["silent", "short", "wrong-rate", "conversion-error", "spawn-error"] as const)("rejects %s audio without starting Whisper", async mode => {
    const f = await fixture(), native = nativeFixture(mode);
    await expect(transcribeVoiceReference(f.input, { ...native, resolveRuntimeImpl: f.resolveRuntimeImpl })).rejects.toThrow();
    expect(native.spawnImpl).toHaveBeenCalledTimes(1); expect(await readdir(path.join(f.root, "tmp"))).toEqual([]); expect(await readdir(path.join(f.root, "locks"))).toEqual([]);
  });
  it.each(["invalid-json", "mismatched-language", "no-speech", "runtime-error"] as const)("returns safe %s error and cleans confirmed scratch", async mode => {
    const f = await fixture(), native = nativeFixture(mode);
    await expect(transcribeVoiceReference(f.input, { ...native, resolveRuntimeImpl: f.resolveRuntimeImpl })).rejects.not.toThrow("private");
    expect(await readdir(path.join(f.root, "tmp"))).toEqual([]); expect(await readdir(path.join(f.root, "locks"))).toEqual([]);
  });
  it("shares one total deadline across FFmpeg and recognition", async () => {
    const f = await fixture();
    let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now), timers = vi.spyOn(globalThis, "setTimeout");
    const native = nativeFixture("hang-asr", 0, 0, () => { now += 35; });
    try {
      await expect(transcribeVoiceReference(f.input, { ...native, resolveRuntimeImpl: f.resolveRuntimeImpl, timeoutMs: 75, exitWaitMs: 1000 })).rejects.toMatchObject({ statusCode: 504 });
      expect(native.spawnImpl).toHaveBeenCalledTimes(2); expect(native.children[0].kill).not.toHaveBeenCalled(); expect(native.children[1].kill).toHaveBeenCalledWith("SIGKILL");
      expect(timers.mock.calls.filter(call => call[1] === 75)).toHaveLength(1);
      expect(timers.mock.calls.filter(call => call[1] === 40)).toHaveLength(1);
      expect(await readdir(path.join(f.root, "tmp"))).toEqual([]);
    } finally { timers.mockRestore(); clock.mockRestore(); }
  });
  it("cancels a running ASR and confirms exit before scratch/lock cleanup", async () => {
    const f = await fixture(), native = nativeFixture("hang-asr"), controller = new AbortController();
    const pending = transcribeVoiceReference({ ...f.input, signal: controller.signal }, { ...native, resolveRuntimeImpl: f.resolveRuntimeImpl });
    await waitUntil(async () => native.children.length === 2); controller.abort();
    await expect(pending).rejects.toMatchObject({ statusCode: 499 }); expect(native.children[1].kill).toHaveBeenCalledWith("SIGKILL");
    expect(await readdir(path.join(f.root, "tmp"))).toEqual([]); expect(await readdir(path.join(f.root, "locks"))).toEqual([]);
  });
  it("retains an unconfirmed child reservation and scratch until late exit", async () => {
    const f = await fixture(), native = nativeFixture("unconfirmed"), controller = new AbortController();
    const pending = transcribeVoiceReference({ ...f.input, signal: controller.signal }, { ...native, resolveRuntimeImpl: f.resolveRuntimeImpl, exitWaitMs: 10 });
    await waitUntil(async () => native.children.length === 1); controller.abort();
    await expect(pending).rejects.toMatchObject({ statusCode: 503 });
    const lock = path.join(f.root, "locks", "voxcpm2-generation.lock");
    expect(await exists(lock)).toBe(true); expect(await readdir(path.join(f.root, "tmp"))).toHaveLength(1);
    const contender = nativeFixture();
    await expect(transcribeVoiceReference(f.input, { ...contender, resolveRuntimeImpl: f.resolveRuntimeImpl })).rejects.toMatchObject({ statusCode: 409 }); expect(contender.spawnImpl).not.toHaveBeenCalled();
    native.children[0].emit("close", null);
    await waitUntil(async () => !await exists(lock) && (await readdir(path.join(f.root, "tmp"))).length === 0);
  });
  it("rejects pre-cancelled requests and missing local model without native work", async () => {
    const f = await fixture(), native = nativeFixture(), controller = new AbortController(); controller.abort();
    await expect(transcribeVoiceReference({ ...f.input, signal: controller.signal }, native)).rejects.toMatchObject({ statusCode: 499 });
    await expect(transcribeVoiceReference(f.input, native)).rejects.toMatchObject({ statusCode: 503 }); expect(native.spawnImpl).not.toHaveBeenCalled();
  });
  it("maps a native reservation storage failure to actionable 507", async () => {
    const f = await fixture(), native = nativeFixture();
    await expect(transcribeVoiceReference(f.input, { ...native, resolveRuntimeImpl: async () => { throw new LocalStorageError(); } })).rejects.toMatchObject({ statusCode: 507 });
    expect(native.spawnImpl).not.toHaveBeenCalled();
  });
});
