import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { BatchDownloadError, prepareBatchDownload } from "@/lib/asmr/local-batch-download";
import { demoProject } from "@/lib/asmr/mock-project";
import { POST } from "./route";

vi.mock("@/lib/asmr/local-batch-download", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/asmr/local-batch-download")>(), prepareBatchDownload: vi.fn(),
}));
const prepare = vi.mocked(prepareBatchDownload);
let root: string, cleanup: Mock<() => Promise<void>>;
beforeEach(async () => {
  const base = process.platform === "win32" ? "I:/AI" : tmpdir();
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-batch-route-"));
  const filePath = path.join(root, "audio.zip");
  await writeFile(filePath, Uint8Array.from([80, 75, 3, 4, 5, 6]));
  cleanup = vi.fn(async () => {});
  prepare.mockReset();
  prepare.mockResolvedValue({ filePath, filename: "雨夜_已采用音频.zip", clipCount: 2, size: 6, cleanup });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const request = () => new Request("http://localhost/api/assets/batch-download", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: demoProject }) });

describe("POST /api/assets/batch-download", () => {
  it("validates the project and streams a UTF-8 download with cleanup after reading", async () => {
    const input = request();
    const response = await POST(input);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-length")).toBe("6");
    expect(response.headers.get("x-asmr-clip-count")).toBe("2");
    expect(response.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("雨夜_已采用音频.zip")}`);
    expect(prepare).toHaveBeenCalledWith(demoProject, expect.any(Object), input.signal);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([80, 75, 3, 4, 5, 6]);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("rejects malformed JSON, invalid project structures and already cancelled requests", async () => {
    for (const body of ["{", "{}", JSON.stringify({ project: { project_id: "x" } })]) {
      const response = await POST(new Request("http://localhost/api/assets/batch-download", { method: "POST", body }));
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
    const aborted = new AbortController(); aborted.abort();
    expect((await POST(new Request("http://localhost/api/assets/batch-download", { method: "POST", signal: aborted.signal }))).status).toBe(499);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns processing errors as JSON before producing a download", async () => {
    prepare.mockRejectedValueOnce(new BatchDownloadError("空间处理不可用。", 503));
    const failed = await POST(request());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "空间处理不可用。" });
    prepare.mockRejectedValueOnce(new Error("server secret path"));
    const unknown = await POST(request());
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(await unknown.json())).not.toContain("secret");
  });

  it("limits concurrent archive preparation and releases the slot on failures", async () => {
    let fail!: (error: Error) => void;
    prepare.mockImplementationOnce(async () => new Promise((_resolve, reject) => { fail = reject; }));
    const first = POST(request());
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect((await POST(request())).status).toBe(429);
    fail(new BatchDownloadError("已取消批量下载。", 499));
    expect((await first).status).toBe(499);
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    await retry.arrayBuffer();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("cleans the prepared ZIP when the response consumer cancels", async () => {
    const response = await POST(request());
    await response.body!.cancel();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });
});
