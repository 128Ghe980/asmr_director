import { mkdtemp, mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writePcm16Wav } from "./pcm-audio";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { getVoiceGenerationRoot, listVoiceGenerationRecordings, resolveVoiceGenerationRecording } from "./voice-generation-recordings";
import { GET as audioGET } from "../../app/api/voice-generation-recordings/[recordingId]/route";
import { GET as listGET } from "../../app/api/voice-generation-recordings/route";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

const id = "11111111-2222-4333-8444-555555555555";
const text = "回来啦？外面是不是很冷？";
const wav = writePcm16Wav(new Float32Array(48_000).fill(.125), 48_000);
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function setup(external = false) {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "asmr-recordings-"));
  vi.stubEnv("ASMR_DIRECTOR_RUNTIME_ROOT", runtimeRoot);
  vi.stubEnv("ASMR_VOICE_WORK_ROOT", external ? path.join(runtimeRoot, "external-work") : "");
  return getLocalRuntimeConfig();
}

async function take(root: string, runId = id, extra: Record<string, unknown> = {}, failure?: Record<string, unknown>) {
  const directory = path.join(root, "long-text", runId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "plan.json"), JSON.stringify({
    plan: { clauses: [text] }, targets: [{ expectedText: text, text: `${text}补充文案。` }],
    createdAt: "2026-09-20T08:27:03.201Z", ...extra,
  }));
  await writeFile(path.join(directory, "group-1-take-1-source.wav"), wav);
  if (failure) await writeFile(path.join(directory, "group-1-take-1-failure.json"), JSON.stringify(failure));
  return directory;
}

describe("complete original voice recordings", () => {
  it("uses the external work root when configured", async () => {
    const config = await setup();
    expect(getVoiceGenerationRoot(config)).toBe(path.join(config.runtimeRoot, "voxcpm2-product"));
    expect(getVoiceGenerationRoot(config, { ASMR_VOICE_WORK_ROOT: path.join(config.runtimeRoot, "work") })).toBe(path.join(config.runtimeRoot, "work"));
  });

  it("recovers failed legacy audio by exact text and serves unchanged bytes", async () => {
    const config = await setup(true);
    await take(path.join(config.runtimeRoot, "voxcpm2-product"), id, {}, { code: "uncertain_word_alignment" });
    const result = await listVoiceGenerationRecordings({ config, projectId: "project", clipId: "clip", text });
    expect(result.recordings).toHaveLength(1);
    expect(result.recordings[0]).toMatchObject({ historicalMatch: true, duration: 1, group: 1, take: 1, status: "needs_review" });
    expect(result.recordings[0].warning).toContain("识别差异");
    const source = await resolveVoiceGenerationRecording(config, result.recordings[0].recordingId);
    expect(new Uint8Array(await readFile(source.filePath))).toEqual(wav);
    expect((await listVoiceGenerationRecordings({ config, projectId: "project", clipId: "clip", text: "回来啦，外面是不是很冷？" })).recordings).toHaveLength(0);
  });

  it("lists new recordings during checks and keeps owner isolation", async () => {
    const config = await setup();
    const directory = await take(getVoiceGenerationRoot(config), id, { projectId: "project", clipId: "clip", sourceFingerprint: "fingerprint" });
    const query = { config, projectId: "project", clipId: "clip", text };
    expect((await listVoiceGenerationRecordings(query)).recordings[0]).toMatchObject({ status: "recorded", historicalMatch: false });
    expect((await listVoiceGenerationRecordings({ ...query, projectId: "foreign" })).recordings).toHaveLength(0);
    expect((await listVoiceGenerationRecordings({ ...query, clipId: "foreign" })).recordings).toHaveLength(0);
    await writeFile(path.join(directory, "group-1-take-1-analysis.json"), JSON.stringify({ transcript: text, cutEndSeconds: 1 }));
    expect((await listVoiceGenerationRecordings(query)).recordings[0].status).toBe("checked");
  });

  it("does not hide complete source bytes when later metadata is malformed", async () => {
    const config = await setup();
    const directory = await take(getVoiceGenerationRoot(config));
    await writeFile(path.join(directory, "group-1-take-1-analysis.json"), "{");
    await writeFile(path.join(directory, "group-1-take-1-failure.json"), "{");
    expect((await listVoiceGenerationRecordings({ config, projectId: "p", clipId: "c", text })).recordings).toHaveLength(1);
  });

  it("supports current-clip sources and review analysis even without a failure trace", async () => {
    const config = await setup();
    const directory = await take(getVoiceGenerationRoot(config), id, {
      projectId: "project", clipId: "clip", mode: "clip", targets: [{ expectedText: text, inputText: text }],
    });
    await writeFile(path.join(directory, "group-1-take-1-analysis.json"), JSON.stringify({ checkStatus: "review", diagnosticCode: "cut_text_mismatch" }));
    const result = await listVoiceGenerationRecordings({ config, projectId: "project", clipId: "clip", text });
    expect(result.recordings[0]).toMatchObject({ status: "needs_review", expectedText: text, inputText: text });
    expect(result.recordings[0].warning).toContain("识别差异");
  });

  it("keeps whitespace-surrounded clip text visible and describes intentionally unchecked audio", async () => {
    const config = await setup();
    const directory = await take(getVoiceGenerationRoot(config), id, {
      projectId: "project", clipId: "clip", plan: { clauses: [` \n${text} \n`] },
    });
    await writeFile(path.join(directory, "group-1-take-1-analysis.json"), JSON.stringify({ checkStatus: "not_checked", message: "模型可能达到步数上限，请试听结尾。" }));
    const result = await listVoiceGenerationRecordings({ config, projectId: "project", clipId: "clip", text: ` ${text} ` });
    expect(result.recordings[0]).toMatchObject({ status: "not_checked" });
    expect(result.recordings[0].warning).toContain("当前片段原音（未做分组检查）");
    expect(result.recordings[0].warning).toContain("步数上限");
    expect(result.recordings[0].warning).not.toContain("尚未保存");
  });

  it("pages past more than 200 foreign runs without losing older owned audio when new runs appear", async () => {
    const config = await setup();
    const root = getVoiceGenerationRoot(config);
    await take(root, id, { projectId: "project", clipId: "clip" });
    for (let index = 0; index < 205; index++) {
      const directory = path.join(root, "long-text", `11111111-2222-4333-8444-${index.toString(16).padStart(12, "0")}`);
      await mkdir(directory);
      await writeFile(path.join(directory, "plan.json"), JSON.stringify({ projectId: "foreign", clipId: "clip", plan: { clauses: [text] }, targets: [{ expectedText: text, text }] }));
    }
    const query = { config, projectId: "project", clipId: "clip", text };
    const first = await listVoiceGenerationRecordings(query);
    expect(first.recordings).toHaveLength(0);
    expect(first.nextCursor).toBeTruthy();
    const newerId = "11111111-2222-4333-8444-666666666666";
    await take(root, newerId, { projectId: "project", clipId: "clip" });
    const recovered = [];
    let cursor = first.nextCursor;
    let pages = 0;
    while (cursor && pages++ < 10) {
      const page = await listVoiceGenerationRecordings({ ...query, cursor });
      recovered.push(...page.recordings);
      cursor = page.nextCursor;
    }
    expect(pages).toBe(2);
    expect(recovered.map((recording) => recording.runId)).toEqual([id]);
    expect((await listVoiceGenerationRecordings(query)).recordings[0].runId).toBe(newerId);
    await expect(listVoiceGenerationRecordings({ ...query, projectId: "foreign", cursor: first.nextCursor! })).rejects.toThrow("Invalid recording cursor");
  });

  it("resumes within a run rather than hiding takes beyond one page", async () => {
    const config = await setup();
    const directory = await take(getVoiceGenerationRoot(config), id, { targets: [1, 2, 3].map(() => ({ expectedText: text, text })) });
    for (let index = 1; index < 51; index++) {
      const group = Math.floor(index / 20) + 1, attempt = index % 20 + 1;
      await writeFile(path.join(directory, `group-${group}-take-${attempt}-source.wav`), wav);
    }
    const query = { config, projectId: "p", clipId: "c", text };
    const first = await listVoiceGenerationRecordings(query);
    expect(first.recordings).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await listVoiceGenerationRecordings({ ...query, cursor: first.nextCursor! });
    expect(second.recordings).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.recordings, ...second.recordings].map((recording) => recording.recordingId)).size).toBe(51);
  });

  it("rejects traversal, unknown ids and resolved directory escapes", async () => {
    const config = await setup();
    const root = getVoiceGenerationRoot(config);
    const foreign = path.join(config.runtimeRoot, "unrelated");
    await mkdir(path.join(root, "long-text"), { recursive: true });
    await mkdir(foreign);
    await writeFile(path.join(foreign, "group-1-take-1-source.wav"), wav);
    const escaped = path.join(root, "long-text", id);
    await mkdir(escaped);
    const original = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).realpath;
    vi.mocked(realpath).mockImplementation(async (filePath) => String(filePath) === escaped ? foreign : original(filePath));
    for (const recordingId of ["../secret", `current_${id}_501_1`, `current_${id}_1_21`, `current_${id}_1_1`]) {
      await expect(resolveVoiceGenerationRecording(config, recordingId)).rejects.toThrow();
    }
    expect((await listVoiceGenerationRecordings({ config, projectId: "p", clipId: "c", text })).recordings).toHaveLength(0);
    vi.mocked(realpath).mockImplementation(original);
  });

  it("ignores oversized plan metadata", async () => {
    const config = await setup();
    const directory = await take(getVoiceGenerationRoot(config));
    await writeFile(path.join(directory, "plan.json"), " ".repeat(256 * 1024 + 1));
    expect((await listVoiceGenerationRecordings({ config, projectId: "p", clipId: "c", text })).recordings).toHaveLength(0);
  });

  it("supports full downloads and byte ranges without changing or cutting the source", async () => {
    const config = await setup();
    await take(getVoiceGenerationRoot(config));
    const recordingId = `current_${id}_1_1`;
    const context = { params: Promise.resolve({ recordingId }) };
    const response = await audioGET(new Request(`http://localhost/api/voice-generation-recordings/${recordingId}?download=1`), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(wav);
    const range = await audioGET(new Request("http://localhost", { headers: { Range: "bytes=12-31" } }), context);
    expect(range.status).toBe(206);
    expect(range.headers.get("Content-Range")).toBe(`bytes 12-31/${wav.length}`);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(wav.slice(12, 32));
    const suffix = await audioGET(new Request("http://localhost", { headers: { Range: "bytes=-10" } }), context);
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(wav.slice(-10));
    const invalid = await audioGET(new Request("http://localhost", { headers: { Range: `bytes=${wav.length}-` } }), context);
    expect(invalid.status).toBe(416);
  });

  it("validates list request identity and reports actual recorded takes", async () => {
    const config = await setup();
    await take(getVoiceGenerationRoot(config));
    expect((await listGET(new Request("http://localhost/api/voice-generation-recordings"))).status).toBe(400);
    const query = new URLSearchParams({ projectId: "p", clipId: "c", text });
    const response = await listGET(new Request(`http://localhost/api/voice-generation-recordings?${query}`));
    expect(response.status).toBe(200);
    expect((await response.json()).recordings).toHaveLength(1);
  });
});
