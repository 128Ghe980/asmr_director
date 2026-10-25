import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess, spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { writePcm16Wav } from "./pcm-audio";
import { forceAlignVoiceAudio, validateForcedVoiceAlignment, type ForcedVoiceAlignment } from "./voice-forced-alignment";

const wav = writePcm16Wav(Float32Array.from({ length: 48_000 }, (_, i) => Math.sin(i / 5) * .1), 48_000);
const input = { wav, clauses: ["坐"], inputText: "坐……下", mode: "prefix" as const };
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function evidence(): ForcedVoiceAlignment {
  return { method: "ctc_forced", mode: "prefix", sourceSha256: sha(wav), inputTextSha256: sha(input.inputText),
    modelId: "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn", modelRevision: "99ccb2737be22b8bb50dcfcc39ad4d567fb90cfd",
    sampleRate: 48_000, sourceFrames: 48_000, cutFrames: [21_600], contentVerified: false,
    characters: [{ char: "坐", startSeconds: 0, endSeconds: .45, score: 0 }, { char: "下", startSeconds: .45, endSeconds: .8, score: .001 }] };
}

describe("forced CTC timing bridge", () => {
  it("accepts a continuous-speech cut with zero scores and no quiet/content acceptance evidence", () => {
    expect(validateForcedVoiceAlignment(evidence(), input)).toEqual(evidence());
  });
  it("preserves an unsupported original character's wildcard timing instead of replacing the text", () => {
    const request = { ...input, clauses: ["蕉"], inputText: "蕉……下" };
    const result = evidence(); result.inputTextSha256 = sha(request.inputText);
    result.characters[0] = { ...result.characters[0], char: "蕉", wildcard: true };
    expect(validateForcedVoiceAlignment(result, request).characters[0]).toMatchObject({ char: "蕉", wildcard: true, score: 0 });
  });
  it.each([
    ["different original", (r: ForcedVoiceAlignment) => { r.sourceSha256 = "a".repeat(64); }],
    ["different text input", (r: ForcedVoiceAlignment) => { r.inputTextSha256 = "b".repeat(64); }],
    ["extra prefix cut", (r: ForcedVoiceAlignment) => { r.cutFrames = [100, 200]; }],
    ["empty last clip", (r: ForcedVoiceAlignment) => { r.cutFrames = [48_000]; }],
    ["fractional PCM frame", (r: ForcedVoiceAlignment) => { r.cutFrames = [21_600.5]; }],
    ["cut unrelated to the aligned sentence boundary", (r: ForcedVoiceAlignment) => { r.cutFrames = [1000]; }],
    ["overlapping character time", (r: ForcedVoiceAlignment) => { r.characters[1].startSeconds = .1; }],
    ["out-of-recording character", (r: ForcedVoiceAlignment) => { r.characters[1].endSeconds = 1.1; }],
  ])("rejects %s without a quality score gate", (_name, mutate) => {
    const result = evidence(); mutate(result); expect(() => validateForcedVoiceAlignment(result, input)).toThrow();
  });
  it("requires ordered paragraph cuts spanning distinct clips", () => {
    const result = { ...evidence(), mode: "paragraph" as const, cutFrames: [30_000, 20_000] };
    expect(() => validateForcedVoiceAlignment(result, { ...input, mode: "paragraph", clauses: ["一", "二", "三"] })).toThrow();
  });

  async function fixture() {
    const base = process.env.TEMP || "I:/AI/asmr_director/qa/force-split/2026-10-21/bridge-qa";
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "force-bridge-"));
    const model = path.join(root, "model"); await mkdir(model); await writeFile(path.join(model, "config.json"), "{}");
    const config = { ...getLocalRuntimeConfig(), runtimeRoot: root, voiceAlignmentModelPath: model, voiceAlignmentPythonPath: process.execPath };
    return { root, config };
  }
  function mockChild() {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { pid: 12345, kill: vi.fn(() => { setImmediate(() => child.emit("close", null)); return true; }) });
    return child;
  }
  it("passes the complete saved input and only returns a source-bound result after child exit", async () => {
    const { config } = await fixture(), child = mockChild();
    const started = vi.fn(), exited = vi.fn();
    const spawnImpl = vi.fn((_exe, args) => {
      void (async () => {
        const request = JSON.parse(await readFile(args[3], "utf8"));
        expect(request.inputText).toBe(input.inputText); expect(request.mode).toBe("prefix");
        await writeFile(request.outputJson, JSON.stringify({ version: 1, success: true, ...evidence() }));
        child.emit("close", 0);
      })();
      return child;
    }) as unknown as typeof spawn;
    expect(await forceAlignVoiceAudio({ ...input, config }, { spawnImpl, runtimeSession: { runtimeRoot: config.runtimeRoot, processStarted: started, processExited: exited } })).toEqual(evidence());
    expect(started).toHaveBeenCalledWith(12345); expect(exited).toHaveBeenCalledWith(12345);
    expect(spawnImpl).toHaveBeenCalledOnce();
  });
  it("reports a model vocabulary limitation as execution failure without asking for text certification", async () => {
    const { config } = await fixture(), child = mockChild();
    const spawnImpl = vi.fn((_exe, args) => {
      void (async () => {
        const request = JSON.parse(await readFile(args[3], "utf8"));
        await writeFile(request.outputJson, JSON.stringify({ version: 1, success: false, code: "oov_characters" })); child.emit("close", 0);
      })(); return child;
    }) as unknown as typeof spawn;
    await expect(forceAlignVoiceAudio({ ...input, config }, { spawnImpl })).rejects.toMatchObject({ statusCode: 422, diagnosticCode: "oov_characters" });
  });
  it("cancels the owned child and reports its exit before returning", async () => {
    const { config } = await fixture(), child = mockChild(), controller = new AbortController(), exited = vi.fn();
    const spawnImpl = vi.fn(() => { setImmediate(() => controller.abort()); return child; }) as unknown as typeof spawn;
    await expect(forceAlignVoiceAudio({ ...input, config, signal: controller.signal }, {
      spawnImpl, runtimeSession: { runtimeRoot: config.runtimeRoot, processStarted: vi.fn(), processExited: exited },
    })).rejects.toMatchObject({ statusCode: 499 });
    expect(child.kill).toHaveBeenCalledOnce(); expect(exited).toHaveBeenCalledWith(12345);
  });
  it("does not spawn or allocate a request after cancellation", async () => {
    const { config } = await fixture(), spawnImpl = vi.fn(), controller = new AbortController(); controller.abort();
    await expect(forceAlignVoiceAudio({ ...input, config, signal: controller.signal }, { spawnImpl })).rejects.toMatchObject({ statusCode: 499 });
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(await readdir(config.runtimeRoot)).toEqual(["model"]);
  });
});
