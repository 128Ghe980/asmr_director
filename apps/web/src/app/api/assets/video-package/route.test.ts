import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimBatchDownload } from "@/lib/asmr/batch-download-session";
import { BatchDownloadError, type PreparedBatchDownload } from "@/lib/asmr/local-batch-download";
import { prepareVideoPackage } from "@/lib/asmr/local-video-package";
import { demoProject } from "@/lib/asmr/mock-project";
import { GET } from "../batch-download/route";
import { POST } from "./route";

vi.mock("@/lib/asmr/local-video-package", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/asmr/local-video-package")>(), prepareVideoPackage: vi.fn(),
}));
const prepare = vi.mocked(prepareVideoPackage);
const bytes = Uint8Array.from([80, 75, 3, 4, 5, 6]);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V0AAAAASUVORK5CYII=", "base64");
const base = process.platform === "win32" ? "I:/AI/asmr_director/qa/video-package-tests" : tmpdir();
const urls = new Set<string>();
let root: string, archive: PreparedBatchDownload;
beforeEach(async () => {
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "route-"));
  const filePath = path.join(root, "video.zip"); await writeFile(filePath, bytes);
  archive = { filePath, filename: "雨夜_视频项目包.zip", clipCount: 3, size: bytes.length, cleanup: vi.fn(async () => {}) };
  prepare.mockReset(); prepare.mockResolvedValue(archive);
});
afterEach(async () => {
  for (const url of urls) {
    try { await (await claimBatchDownload(new URL(url, "http://localhost").searchParams.get("token"))).cleanup(); }
    catch { /* A successful GET already consumed its token. */ }
  }
  urls.clear(); vi.useRealTimers();
  if (path.dirname(root) !== path.resolve(base)) throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
});
function form(reference?: Blob) {
  const body = new FormData(); body.set("project", JSON.stringify(demoProject));
  if (reference) body.set("reference", reference, "../../pretend.exe");
  return body;
}
function request(body = form(), options: { signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  return new Request("http://localhost/api/assets/video-package", { method: "POST", body, signal: options.signal, headers: options.headers });
}
async function success(input = request()) {
  const response = await POST(input);
  expect(response.status).toBe(200);
  const result = await response.json() as { downloadUrl: string; filename: string; clipCount: number; size: number };
  urls.add(result.downloadUrl);
  return { response, result };
}

describe("video package multipart API", () => {
  it("returns a small token response and reuses the existing streamed single-use download", async () => {
    const input = request(form(new Blob([png], { type: "text/plain" })), { headers: { origin: "http://localhost" } });
    const { response, result } = await success(input);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result).toEqual({ downloadUrl: expect.stringMatching(/^\/api\/assets\/batch-download\?token=[0-9a-f-]{36}$/), filename: archive.filename, clipCount: 3, size: 6 });
    expect(prepare).toHaveBeenCalledWith(demoProject, expect.any(Object), input.signal, { reference: new Uint8Array(png) });
    expect(JSON.stringify(result)).not.toContain(root);
    const downloaded = await GET(new Request(new URL(result.downloadUrl, "http://localhost")));
    expect(downloaded.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
    await vi.waitFor(() => expect(archive.cleanup).toHaveBeenCalledOnce());
    expect((await GET(new Request(new URL(result.downloadUrl, "http://localhost")))).status).toBe(404);
  });

  it("supports packages without an uploaded reference", async () => {
    const input = request(); await success(input);
    expect(prepare).toHaveBeenCalledWith(demoProject, expect.any(Object), input.signal, {});
  });

  it("rejects foreign origins and unsupported request content types before reading inputs", async () => {
    expect((await POST(request(form(), { headers: { origin: "https://foreign.example" } }))).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/assets/video-package", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status).toBe(415);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("bounds declared and streamed multipart bytes, including UTF-8 project field bytes", async () => {
    expect((await POST(request(form(), { headers: { "content-length": String(11 * 1024 * 1024) } }))).status).toBe(413);
    const oversized = form(); oversized.set("project", JSON.stringify({ text: "汉".repeat(750000) }));
    expect((await POST(request(oversized))).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(11 * 1024 * 1024)); controller.close(); } });
    const streamed = new Request("http://localhost/api/assets/video-package", { method: "POST", body: stream, headers: { "content-type": "multipart/form-data; boundary=test" }, duplex: "half" } as RequestInit);
    expect((await POST(streamed)).status).toBe(413);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects malformed projects, duplicate or unknown fields, invalid or oversize references", async () => {
    const cases: { body: FormData; status: number }[] = [];
    const invalidJson = form(); invalidJson.set("project", "{"); cases.push({ body: invalidJson, status: 400 });
    const invalidProject = form(); invalidProject.set("project", "{}"); cases.push({ body: invalidProject, status: 400 });
    const duplicate = form(); duplicate.append("project", JSON.stringify(demoProject)); cases.push({ body: duplicate, status: 400 });
    const unknown = form(); unknown.set("assetPath", "D:/private"); cases.push({ body: unknown, status: 400 });
    const invalidRef = form(); invalidRef.set("reference", "file.png"); cases.push({ body: invalidRef, status: 400 });
    cases.push({ body: form(new Blob([])), status: 400 });
    cases.push({ body: form(new Blob(["fake image"])), status: 415 });
    cases.push({ body: form(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)])), status: 413 });
    for (const item of cases) {
      const response = await POST(request(item.body));
      expect(response.status).toBe(item.status);
      expect(await response.json()).toHaveProperty("error");
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("cancels both already-aborted and stalled multipart bodies without waiting for more bytes", async () => {
    const aborted = new AbortController(); aborted.abort();
    expect((await POST(request(form(), { signal: aborted.signal }))).status).toBe(499);
    const active = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const input = new Request("http://localhost/api/assets/video-package", { method: "POST", body, signal: active.signal, headers: { "content-type": "multipart/form-data; boundary=test" }, duplex: "half" } as RequestInit);
    const pending = POST(input); active.abort();
    expect((await pending).status).toBe(499);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("cleans a prepared archive if canceled before publishing its token and hides unexpected errors", async () => {
    const controller = new AbortController();
    prepare.mockImplementationOnce(async () => { controller.abort(); return archive; });
    expect((await POST(request(form(), { signal: controller.signal }))).status).toBe(499);
    expect(archive.cleanup).toHaveBeenCalledOnce();
    prepare.mockRejectedValueOnce(new Error(root));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(root);
    prepare.mockRejectedValueOnce(new BatchDownloadError("第 2 段缺少分镜。", 400));
    expect(await (await POST(request())).json()).toEqual({ error: "第 2 段缺少分镜。" });
  });

  it("bounds ready tokens before preparation and serializes simultaneous ZIP preparations", async () => {
    await success(); await success();
    expect((await POST(request())).status).toBe(429);
    expect(prepare).toHaveBeenCalledTimes(2);
    for (const url of urls) await (await claimBatchDownload(new URL(url, "http://localhost").searchParams.get("token"))).cleanup();
    urls.clear();
    let resolve!: (archive: PreparedBatchDownload) => void;
    prepare.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = POST(request());
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(3));
    expect((await POST(request())).status).toBe(429);
    resolve(archive);
    const response = await pending; urls.add((await response.json()).downloadUrl);
  });
});
