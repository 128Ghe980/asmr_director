import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { BATCH_DOWNLOAD_TTL_MS } from "@/lib/asmr/batch-download-session";
import { BatchDownloadError, prepareBatchDownload, type PreparedBatchDownload } from "@/lib/asmr/local-batch-download";
import { demoProject } from "@/lib/asmr/mock-project";
import { prepareStoryboardBatchDownload } from "@/lib/asmr/local-storyboard-batch-download";
import { GET, POST } from "./route";

vi.mock("@/lib/asmr/local-batch-download", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/asmr/local-batch-download")>(), prepareBatchDownload: vi.fn(),
}));
vi.mock("@/lib/asmr/local-storyboard-batch-download", () => ({ prepareStoryboardBatchDownload: vi.fn() }));
const prepare = vi.mocked(prepareBatchDownload);
const prepareStoryboard = vi.mocked(prepareStoryboardBatchDownload);
const bytes = Uint8Array.from([80, 75, 3, 4, 5, 6]);
const readyUrls = new Set<string>();
let root: string, archive: PreparedBatchDownload, cleanup: Mock<() => Promise<void>>;
beforeEach(async () => {
  const base = process.platform === "win32" ? "I:/AI" : tmpdir();
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-batch-route-"));
  const filePath = path.join(root, "audio.zip");
  await writeFile(filePath, bytes);
  cleanup = vi.fn(async () => {});
  archive = { filePath, filename: "雨夜_已采用音频.zip", clipCount: 2, size: bytes.length, cleanup };
  prepare.mockReset();
  prepare.mockResolvedValue(archive);
  prepareStoryboard.mockReset();
  prepareStoryboard.mockResolvedValue(archive);
});

afterEach(async () => {
  vi.useRealTimers();
  for (const url of readyUrls) {
    const response = await GET(new Request(new URL(url, "http://localhost")));
    if (response.ok) {
      const previous = cleanup.mock.calls.length;
      await response.arrayBuffer();
      await vi.waitFor(() => expect(cleanup.mock.calls.length).toBeGreaterThan(previous));
    }
  }
  readyUrls.clear();
  await rm(root, { recursive: true, force: true });
});
const request = (metadata = false, signal?: AbortSignal, kind?: unknown) => new Request("http://localhost/api/assets/batch-download", {
  method: "POST", headers: { "content-type": "application/json", ...(metadata ? { accept: "application/json" } : {}) },
  body: JSON.stringify({ project: demoProject, ...(kind === undefined ? {} : { kind }) }), signal,
});
async function metadata() {
  const response = await POST(request(true));
  expect(response.status).toBe(200);
  const result = await response.json() as { downloadUrl: string; filename: string; clipCount: number; size: number };
  readyUrls.add(result.downloadUrl);
  return { response, result };
}
const download = (url: string, signal?: AbortSignal) => GET(new Request(new URL(url, "http://localhost"), { signal }));
function expectArchiveHeaders(response: Response, size = bytes.length) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-length")).toBe(String(size));
  expect(response.headers.get("x-asmr-clip-count")).toBe("2");
  expect(response.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent(archive.filename)}`);
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("batch audio downloads", () => {
  it("preserves the original binary POST API, attachment name, exact bytes and cleanup", async () => {
    const input = request();
    const response = await POST(input);
    expectArchiveHeaders(response);
    expect(prepare).toHaveBeenCalledWith(demoProject, expect.any(Object), input.signal);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("returns small JSON metadata then downloads the prepared ZIP through a single-use GET", async () => {
    const { response, result } = await metadata();
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(result).toEqual({ downloadUrl: expect.stringMatching(/^\/api\/assets\/batch-download\?token=[0-9a-f-]{36}$/), filename: archive.filename, clipCount: 2, size: 6 });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(cleanup).not.toHaveBeenCalled();
    const downloaded = await download(result.downloadUrl);
    expectArchiveHeaders(downloaded);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect(prepare).toHaveBeenCalledOnce();
    expect((await download(result.downloadUrl)).status).toBe(404);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("allows only one concurrent GET to claim the same token", async () => {
    const { result } = await metadata();
    const responses = await Promise.all([download(result.downloadUrl), download(result.downloadUrl)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 404]);
    await responses.find(response => response.ok)!.arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("rejects malformed or unknown tokens without interpreting user input as file paths", async () => {
    for (const token of ["", "../../audio.zip", archive.filePath, "00000000-0000-0000-0000-000000000000"]) {
      const response = await download(`/api/assets/batch-download?token=${encodeURIComponent(token)}`);
      expect(response.status).toBe(token.startsWith("00000000") ? 404 : 400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain(root);
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("expires an abandoned link after five minutes and cleans its archive once", async () => {
    vi.useFakeTimers();
    const { result } = await metadata();
    await vi.advanceTimersByTimeAsync(BATCH_DOWNLOAD_TTL_MS - 1);
    expect(cleanup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cleanup).toHaveBeenCalledOnce();
    expect((await download(result.downloadUrl)).status).toBe(404);
    await vi.advanceTimersByTimeAsync(BATCH_DOWNLOAD_TTL_MS);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("keeps a claimed large download alive past its ready-link expiry", async () => {
    const large = new Uint8Array(2 * 1024 * 1024).fill(73);
    await writeFile(archive.filePath, large);
    archive.size = large.length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { result } = await metadata();
    const downloaded = await download(result.downloadUrl);
    expectArchiveHeaders(downloaded, large.length);
    await vi.advanceTimersByTimeAsync(BATCH_DOWNLOAD_TTL_MS);
    expect(cleanup).not.toHaveBeenCalled();
    const received = new Uint8Array(await downloaded.arrayBuffer());
    expect(received.byteLength).toBe(large.byteLength);
    expect(createHash("sha256").update(received).digest("hex")).toBe(createHash("sha256").update(large).digest("hex"));
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("bounds pending links and releases capacity when one is downloaded", async () => {
    const first = await metadata();
    await metadata();
    const rejected = await POST(request(true));
    expect(rejected.status).toBe(429);
    expect(prepare).toHaveBeenCalledTimes(2);
    await (await download(first.result.downloadUrl)).arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    await metadata();
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it("returns a readable error if the prepared ZIP disappeared before its GET", async () => {
    const { result } = await metadata();
    await rm(archive.filePath);
    const response = await download(result.downloadUrl);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "下载包暂不可用，请重新打包。" });
    expect(cleanup).toHaveBeenCalledOnce();
    expect((await download(result.downloadUrl)).status).toBe(404);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects a truncated archive before returning binary download headers", async () => {
    await writeFile(archive.filePath, bytes.subarray(0, 3));
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects malformed JSON, invalid projects and already canceled preparation", async () => {
    for (const body of ["{", "{}", JSON.stringify({ project: { project_id: "x" } })]) {
      const response = await POST(new Request("http://localhost/api/assets/batch-download", { method: "POST", body }));
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
    const controller = new AbortController(); controller.abort();
    expect((await POST(request(true, controller.signal))).status).toBe(499);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("cleans an archive when preparation is canceled before publishing metadata", async () => {
    const controller = new AbortController();
    prepare.mockImplementationOnce(async () => { controller.abort(); return archive; });
    expect((await POST(request(true, controller.signal))).status).toBe(499);
    expect(cleanup).toHaveBeenCalledOnce();
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    await retry.arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
  });

  it("leaves a ready token usable when its GET is canceled before claiming", async () => {
    const { result } = await metadata();
    const controller = new AbortController(); controller.abort();
    expect((await download(result.downloadUrl, controller.signal)).status).toBe(499);
    expect(cleanup).not.toHaveBeenCalled();
    expect(new Uint8Array(await (await download(result.downloadUrl)).arrayBuffer())).toEqual(bytes);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("cleans a GET archive when the response consumer cancels", async () => {
    const { result } = await metadata();
    const response = await download(result.downloadUrl);
    await response.body!.cancel();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect((await download(result.downloadUrl)).status).toBe(404);
  });

  it("returns processing failures as JSON before creating a download", async () => {
    prepare.mockRejectedValueOnce(new BatchDownloadError("空间处理不可用。", 503));
    const failed = await POST(request(true));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "空间处理不可用。" });
    prepare.mockRejectedValueOnce(new Error("server secret path"));
    const unknown = await POST(request());
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(await unknown.json())).not.toContain("secret");
  });

  it("limits concurrent archive preparation in both modes and releases failed work", async () => {
    let fail!: (error: Error) => void;
    prepare.mockImplementationOnce(async () => new Promise((_resolve, reject) => { fail = reject; }));
    const first = POST(request());
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect((await POST(request(true))).status).toBe(429);
    fail(new BatchDownloadError("已取消批量下载。", 499));
    expect((await first).status).toBe(499);
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    await retry.arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("retains cleanup when a binary POST response consumer cancels", async () => {
    const response = await POST(request());
    await response.body!.cancel();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });
});

describe("storyboard batch downloads", () => {
  it("selects storyboard preparation for metadata and streams the same single-use native GET", async () => {
    archive.filename = "雨夜_分镜.zip";
    const input = request(true, undefined, "storyboard");
    const response = await POST(input);
    expect(response.status).toBe(200);
    const result = await response.json();
    readyUrls.add(result.downloadUrl);
    expect(result).toEqual({ downloadUrl: expect.stringMatching(/^\/api\/assets\/batch-download\?token=[0-9a-f-]{36}$/), filename: archive.filename, clipCount: 2, size: bytes.length });
    expect(prepareStoryboard).toHaveBeenCalledExactlyOnceWith(demoProject, expect.any(Object), input.signal);
    expect(prepare).not.toHaveBeenCalled();
    const downloaded = await download(result.downloadUrl);
    expectArchiveHeaders(downloaded);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect((await download(result.downloadUrl)).status).toBe(404);
  });

  it("retains binary POST for explicit storyboard and explicit audio kinds", async () => {
    archive.filename = "雨夜_分镜.zip";
    const storyboard = await POST(request(false, undefined, "storyboard"));
    expectArchiveHeaders(storyboard);
    await storyboard.arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect(prepareStoryboard).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
    archive.filename = "雨夜_已采用音频.zip";
    const audio = await POST(request(false, undefined, "audio"));
    expectArchiveHeaders(audio);
    await audio.arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
    expect(prepare).toHaveBeenCalledOnce();
  });

  it.each(["video", "", null, false, 1, {}, []])("strictly rejects unsupported kind %j before either preparer runs", async kind => {
    const response = await POST(request(true, undefined, kind));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "批量下载类型无效，请选择音频或分镜。" });
    expect(prepare).not.toHaveBeenCalled();
    expect(prepareStoryboard).not.toHaveBeenCalled();
  });

  it("returns zero-ready storyboard errors as readable JSON and releases preparation capacity", async () => {
    prepareStoryboard.mockRejectedValueOnce(new BatchDownloadError("当前工程还没有可导出的分镜。", 400));
    const empty = await POST(request(true, undefined, "storyboard"));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "当前工程还没有可导出的分镜。" });
    const retry = await POST(request(false, undefined, "storyboard"));
    expect(retry.status).toBe(200);
    await retry.arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("shares the single preparation lock across audio and storyboard kinds", async () => {
    let fail!: (error: Error) => void;
    prepareStoryboard.mockImplementationOnce(async () => new Promise((_resolve, reject) => { fail = reject; }));
    const first = POST(request(true, undefined, "storyboard"));
    await vi.waitFor(() => expect(prepareStoryboard).toHaveBeenCalledOnce());
    expect((await POST(request())).status).toBe(429);
    expect(prepare).not.toHaveBeenCalled();
    fail(new BatchDownloadError("已取消批量下载。", 499));
    expect((await first).status).toBe(499);
  });

  it("cleans storyboard preparation canceled before its metadata is published", async () => {
    const controller = new AbortController();
    prepareStoryboard.mockImplementationOnce(async () => { controller.abort(); return archive; });
    const response = await POST(request(true, controller.signal, "storyboard"));
    expect(response.status).toBe(499);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
