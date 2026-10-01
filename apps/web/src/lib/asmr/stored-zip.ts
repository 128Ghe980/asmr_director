import { open, type FileHandle } from "node:fs/promises";

const utf8 = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export class ZipLimitError extends Error {}

type CentralEntry = { name: Uint8Array; crc: number; size: number; offset: number };

/** ZIP32 with UTF-8 names, stored entries and data descriptors; memory stays per chunk. */
export class StoredZipWriter {
  private offset = 0;
  private entries: CentralEntry[] = [];
  private constructor(private file: FileHandle, private maxBytes: number, private signal?: AbortSignal) {}

  static async create(filePath: string, maxBytes: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return new StoredZipWriter(await open(filePath, "wx"), maxBytes, signal);
  }

  private async write(bytes: Uint8Array) {
    this.signal?.throwIfAborted();
    if (this.offset + bytes.byteLength > Math.min(this.maxBytes, 0xffffffff)) throw new ZipLimitError("音频包过大，请分工程下载。");
    let written = 0;
    while (written < bytes.byteLength) {
      this.signal?.throwIfAborted();
      const result = await this.file.write(bytes, written, bytes.byteLength - written, this.offset);
      if (result.bytesWritten === 0) throw new Error("Unable to write ZIP");
      written += result.bytesWritten;
      this.offset += result.bytesWritten;
    }
  }

  async add(name: string, data: Uint8Array | AsyncIterable<Uint8Array>) {
    if (name.startsWith("/") || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Unsafe ZIP path");
    const encodedName = utf8.encode(name);
    if (encodedName.length > 0xffff || this.entries.length >= 0xffff) throw new ZipLimitError("音频包文件数量或文件名过长。");
    const entryOffset = this.offset;
    const header = new Uint8Array(30 + encodedName.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0808, true); // UTF-8 and streaming data descriptor.
    view.setUint16(12, 0x0021, true); // Stable DOS date: 1980-01-01.
    view.setUint16(26, encodedName.length, true);
    header.set(encodedName, 30);
    await this.write(header);
    let crc = 0xffffffff, size = 0;
    const append = async (chunk: Uint8Array) => {
      for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
      size += chunk.byteLength;
      if (size > 0xffffffff) throw new ZipLimitError("音频文件过大。");
      await this.write(chunk);
    };
    if (data instanceof Uint8Array) {
      // Yield between bounded chunks even when a processed WAV is supplied as one large buffer.
      for (let offset = 0; offset < data.byteLength; offset += 64 * 1024) await append(data.subarray(offset, offset + 64 * 1024));
    }
    else for await (const chunk of data) await append(chunk);
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = new Uint8Array(16), descriptorView = new DataView(descriptor.buffer);
    descriptorView.setUint32(0, 0x08074b50, true);
    descriptorView.setUint32(4, crc, true);
    descriptorView.setUint32(8, size, true);
    descriptorView.setUint32(12, size, true);
    await this.write(descriptor);
    this.entries.push({ name: encodedName, crc, size, offset: entryOffset });
  }

  async finish(): Promise<number> {
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      const header = new Uint8Array(46 + entry.name.length), view = new DataView(header.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0808, true);
      view.setUint16(14, 0x0021, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint32(42, entry.offset, true);
      header.set(entry.name, 46);
      await this.write(header);
    }
    const centralSize = this.offset - centralOffset;
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    await this.write(end);
    await this.close();
    return this.offset;
  }

  async close() { await this.file.close(); }
}
