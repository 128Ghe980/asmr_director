import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProject } from "../../../lib/asmr/mock-project";
import { asmrSoundFixture } from "../../../lib/asmr/asmr-sound-test-fixture";
import { writePcm16Wav } from "../../../lib/asmr/pcm-audio";
import { createClipVideoSourceFingerprint } from "../../../lib/asmr/video-plan";
import { POST } from "./route";

const base = path.resolve(tmpdir());
let root: string;
const generated = { title: "轻声迎接", visual: "S1 stands in the same warm kitchen, matching the reference appearance and outfit.", action: "S1 gently gestures toward the counter.", camera: "Static medium close-up with a visible mouth.", asmrSound: asmrSoundFixture };
function request(body: unknown) { return new Request("http://localhost/api/clip-storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

beforeEach(async () => {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-clip-video-route-"));
  vi.stubEnv("ASMR_CLIP_ASSET_ROOT", root);
  await writeFile(path.join(root, "adopted.wav"), writePcm16Wav(new Float32Array(1600).fill(.1), 8000));
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers();
  if (path.dirname(path.resolve(root)) === base && path.basename(root).startsWith("asmr-clip-video-route-")) await rm(root, { recursive: true, force: true });
});

function fixture() {
  const project = structuredClone(demoProject);
  const voice = project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0];
  for (const track of project.timeline.tracks) track.clips = [];
  voice.start = 0;
  voice.duration = .05;
  voice.generation.status = "asset_generated";
  voice.asset = { asset_id: "adopted", uri: "asset://clip/adopted", duration: 123 };
  project.timeline.tracks.find((track) => track.track_type === "voice")!.clips.push(voice);
  project.videoPlan = { version: 1, sceneDescription: "A quiet warm home kitchen with wooden cabinets.", shots: {} };
  return { provider: "ollama", project, clipId: voice.id };
}

describe("/api/clip-storyboard", () => {
  it("defaults to an independent shot and returns measured local-audio metadata with server provenance", async () => {
    const input = fixture();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: { content: JSON.stringify(generated) } })));
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ storyboard: { ...generated, version: 1, promptFormat: "minimax-h3", clipId: input.clipId, sourceFingerprint: createClipVideoSourceFingerprint(input.project, input.clipId), audio: { assetId: "adopted", uri: "asset://clip/adopted", duration: .2 } }, provider: "ollama" });
    expect(body.storyboard).not.toHaveProperty("previousClipId");
    expect(body.storyboard).not.toHaveProperty("previousPromptFingerprint");
  });

  it("rejects malformed JSON, invalid projects and browser-supplied paths, URLs or keys", async () => {
    const input = fixture(), fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    expect((await POST(new Request("http://localhost/api/clip-storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status).toBe(400);
    for (const body of [{ ...input, project: {} }, { ...input, provider: "other" }, { ...input, clipId: "" }, { ...input, filePath: "D:/secret.wav" }, { ...input, url: "https://attacker.example" }, { ...input, key: "browser-secret" }, { ...input, instruction: "x".repeat(1201) }, { ...input, includePrevious: "true" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces adopted local voices and requires an available predecessor when continuity is requested", async () => {
    const input = fixture(), fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const unadopted = structuredClone(input);
    unadopted.project.timeline.tracks.find((track) => track.track_type === "voice")!.clips[0].generation.status = "asset_pending";
    expect((await POST(request(unadopted))).status).toBe(400);
    expect((await POST(request({ ...input, clipId: "sfx_001" }))).status).toBe(400);
    expect((await POST(request({ ...input, includePrevious: true }))).status).toBe(409);
    await rm(path.join(root, "adopted.wav"));
    expect((await POST(request(input))).status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-JSON, cross-origin and oversized requests without dispatch", async () => {
    const input = fixture(), fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    expect((await POST(new Request("http://localhost/api/clip-storyboard", { method: "POST", body: JSON.stringify(input) }))).status).toBe(415);
    const crossOrigin = request(input);
    crossOrigin.headers.set("origin", "https://other.example");
    expect((await POST(crossOrigin)).status).toBe(403);
    expect((await POST(request({ text: "x".repeat(1024 * 1024) }))).status).toBe(413);
    const declared = request(input);
    declared.headers.set("content-length", String(1024 * 1024 + 1));
    expect((await POST(declared)).status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("matches the browser Host when Next normalizes the URL to localhost", async () => {
    vi.stubEnv("ASMR_PLANNER_API_KEY", "");
    const local = request({ ...fixture(), provider: "api" });
    local.headers.set("host", "127.0.0.1:3001");
    local.headers.set("origin", "http://127.0.0.1:3001");
    expect((await POST(local)).status).toBe(503);
  });

  it("bounds body receive time and cancels a partial upload before asset or model work", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const controller = new AbortController(), cancelled = vi.fn();
    const body = new ReadableStream({ start(writer) { writer.enqueue(new TextEncoder().encode("{")); }, cancel: cancelled });
    const pending = POST(new Request("http://localhost/api/clip-storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal, duplex: "half" } as RequestInit));
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(cancelled).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    const hanging = new ReadableStream({ start(writer) { writer.enqueue(new TextEncoder().encode("{")); } });
    const timeout = POST(new Request("http://localhost/api/clip-storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: hanging, duplex: "half" } as RequestInit));
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await timeout).status).toBe(408);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects model-forged audio metadata and hides private upstream errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ message: { content: JSON.stringify({ ...generated, audio: { duration: 999, uri: "remote" } }) } }))
      .mockRejectedValueOnce(new Error("private credential stack trace"));
    vi.stubGlobal("fetch", fetchImpl);
    expect((await POST(request(fixture()))).status).toBe(502);
    const offline = await POST(request(fixture()));
    expect(offline.status).toBe(503);
    expect(await offline.text()).not.toContain("private credential");
  });
});
