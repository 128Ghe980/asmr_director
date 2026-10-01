import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoredZipWriter, ZipLimitError } from "./stored-zip";

let root: string;
beforeEach(async () => {
  const base = process.platform === "win32" ? "I:/AI" : tmpdir();
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "asmr-zip-test-"));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("streamed stored ZIP", () => {
  it("writes UTF-8 central directory, standard CRC32 and streamed data without modifying bytes", async () => {
    const file = path.join(root, "audio.zip");
    const writer = await StoredZipWriter.create(file, 4096);
    async function* chunks() { yield new TextEncoder().encode("1234"); yield new TextEncoder().encode("56789"); }
    const name = "工程/无后处理/001_人声.wav";
    await writer.add(name, chunks());
    const size = await writer.finish();
    const bytes = await readFile(file);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(size).toBe(bytes.length);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x0808);
    const filenameLength = view.getUint16(26, true);
    expect(bytes.subarray(30, 30 + filenameLength).toString("utf8")).toBe(name);
    expect(bytes.subarray(30 + filenameLength, 39 + filenameLength).toString()).toBe("123456789");
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(1);
    const central = view.getUint32(end + 16, true);
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    expect(view.getUint32(central + 16, true)).toBe(0xcbf43926); // Published CRC32 reference vector.
    expect(view.getUint32(central + 24, true)).toBe(9);
    expect(view.getUint32(central + 42, true)).toBe(0);
  });

  it("rejects unsafe entry paths, archive overflows and cancellation", async () => {
    const writer = await StoredZipWriter.create(path.join(root, "limit.zip"), 64);
    for (const name of ["../outside", "/root/file", "工程/../outside", "工程\\file"]) {
      await expect(writer.add(name, new Uint8Array())).rejects.toThrow("Unsafe ZIP path");
    }
    await expect(writer.add("a.wav", new Uint8Array(100))).rejects.toBeInstanceOf(ZipLimitError);
    await writer.close();
    const abort = new AbortController();
    const cancelled = await StoredZipWriter.create(path.join(root, "cancel.zip"), 1024, abort.signal);
    abort.abort();
    await expect(cancelled.add("a.wav", new Uint8Array(3))).rejects.toThrow();
    await cancelled.close();
  });
});
