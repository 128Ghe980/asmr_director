import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import * as fileSystem from "node:fs/promises";
import * as crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalRuntimeConfig } from "./local-runtime-config";
import {
  resolveClipAssetPath,
  resolveMixAssetPath,
  saveClipAsset,
  saveMixAsset,
} from "./local-asset-store";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) };
});
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

const temporaryRoots: string[] = [];

async function makeTemporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "asmr-assets-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const actualCrypto = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  vi.mocked(fileSystem.writeFile).mockImplementation(actualFs.writeFile);
  vi.mocked(fileSystem.rename).mockImplementation(actualFs.rename);
  vi.mocked(crypto.randomUUID).mockImplementation(actualCrypto.randomUUID);
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function makeConfig(
  clipAssetRoot: string,
  mixAssetRoot = path.join(path.dirname(clipAssetRoot), "mixes"),
): LocalRuntimeConfig {
  return {
    runtimeRoot: path.dirname(clipAssetRoot),
    gptSovitsBaseUrl: "http://127.0.0.1:9880",
    voicePackPath: path.join(path.dirname(clipAssetRoot), "voice-pack.json"),
    clipAssetRoot,
    mixAssetRoot,
  };
}

describe("local asset store", () => {
  it("stores WAV bytes and returns a durable clip asset URI", async () => {
    const root = await makeTemporaryRoot();
    const config = makeConfig(path.join(root, "clips"));
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

    const asset = await saveClipAsset({
      config,
      clipId: "voice_001",
      wav,
      duration: 7.5,
      now: new Date("2026-07-07T00:00:00.000Z"),
    });

    expect(asset.assetId).toMatch(/^voice_001_20260707T000000000Z_[a-z0-9]+$/);
    expect(asset.uri).toBe(`asset://clip/${asset.assetId}`);
    expect(asset.duration).toBe(7.5);
    await expect(
      readFile(resolveClipAssetPath(asset.assetId, config)),
    ).resolves.toEqual(Buffer.from(wav));
    expect(await readdir(config.clipAssetRoot)).toEqual([`${asset.assetId}.wav`]);
  });

  it("rejects unsafe asset IDs", () => {
    const config = makeConfig("D:\\runtime\\assets\\clips\\app");

    expect(() => resolveClipAssetPath("..\\secret", config)).toThrow(
      "Invalid clip asset id",
    );
    expect(() => resolveClipAssetPath("../secret", config)).toThrow(
      "Invalid clip asset id",
    );
  });

  it("stores WAV bytes and returns a durable mix asset URI", async () => {
    const root = await makeTemporaryRoot();
    const config = makeConfig(path.join(root, "clips"), path.join(root, "mixes"));
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

    const asset = await saveMixAsset({
      config,
      projectId: "asmr_demo_001",
      exportType: "wav",
      wav: wav.buffer,
      duration: 210,
      now: new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(asset.assetId).toMatch(
      /^asmr_demo_001_wav_20260710T000000000Z_[a-z0-9]+$/,
    );
    expect(asset.uri).toBe(`asset://mix/${asset.assetId}`);
    expect(asset.duration).toBe(210);
    await expect(
      readFile(resolveMixAssetPath(asset.assetId, config)),
    ).resolves.toEqual(Buffer.from(wav));
    expect(await readdir(config.mixAssetRoot)).toEqual([`${asset.assetId}.wav`]);
  });

  it("rejects unsafe mix asset IDs", () => {
    const config = makeConfig("D:\\runtime\\clips", "D:\\runtime\\mixes");

    expect(() => resolveMixAssetPath("..\\secret", config)).toThrow(
      "Invalid mix asset id",
    );
    expect(() => resolveMixAssetPath("../secret", config)).toThrow(
      "Invalid mix asset id",
    );
  });

  describe.each(["clip", "mix"] as const)("atomic %s asset publishing", (kind) => {
    async function prepare() {
      const root = await makeTemporaryRoot();
      const config = makeConfig(path.join(root, "clips"));
      const directory = kind === "clip" ? config.clipAssetRoot : config.mixAssetRoot;
      await mkdir(directory, { recursive: true });
      vi.mocked(crypto.randomUUID)
        .mockReturnValueOnce("12345678-1234-1234-1234-123456789abc")
        .mockReturnValueOnce("abcdef12-1234-1234-1234-123456789abc");
      const assetId = `${kind === "clip" ? "voice_001" : "project_001_wav"}_20261002T000000000Z_12345678`;
      const target = path.join(directory, `${assetId}.wav`);
      const temporary = `${target}.abcdef12-1234-1234-1234-123456789abc.tmp`;
      const unrelatedTemporary = path.join(directory, "another-request.wav.tmp");
      const previous = path.join(directory, "previous.wav");
      const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      await actualFs.writeFile(previous, "adopted-audio");
      await actualFs.writeFile(unrelatedTemporary, "other-request");
      const input = { config, wav: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]), duration: 3.21, now: new Date("2026-10-02T00:00:00.000Z") };
      const save = () => kind === "clip"
        ? saveClipAsset({ ...input, clipId: "voice_001" })
        : saveMixAsset({ ...input, projectId: "project_001", exportType: "wav" });
      return { actualFs, directory, target, temporary, unrelatedTemporary, previous, save };
    }

    it("does not publish partial bytes after ENOSPC and cleans only its own temporary", async () => {
      const { actualFs, directory, target, temporary, unrelatedTemporary, previous, save } = await prepare();
      const failure = Object.assign(new Error("Disk is full"), { code: "ENOSPC" });
      vi.mocked(fileSystem.writeFile).mockImplementationOnce(async (file, _data, options) => {
        expect(String(file)).toBe(temporary);
        await actualFs.writeFile(file, new Uint8Array([82, 73]), options);
        throw failure;
      });

      await expect(save()).rejects.toBe(failure);
      await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(temporary)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(previous, "utf8")).toBe("adopted-audio");
      expect(await readFile(unrelatedTemporary, "utf8")).toBe("other-request");
      expect((await readdir(directory)).sort()).toEqual(["another-request.wav.tmp", "previous.wav"]);
    });

    it("preserves existing public audio and removes the temporary if rename fails", async () => {
      const { actualFs, target, temporary, unrelatedTemporary, previous, save } = await prepare();
      await actualFs.writeFile(target, "existing-published-audio");
      const failure = Object.assign(new Error("Publish denied"), { code: "EACCES" });
      vi.mocked(fileSystem.rename).mockImplementationOnce(async (source, destination) => {
        expect(String(source)).toBe(temporary);
        expect(String(destination)).toBe(target);
        expect(await readFile(source)).toEqual(Buffer.from([82, 73, 70, 70, 1, 2, 3, 4]));
        throw failure;
      });

      await expect(save()).rejects.toBe(failure);
      expect(await readFile(target, "utf8")).toBe("existing-published-audio");
      await expect(readFile(temporary)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(previous, "utf8")).toBe("adopted-audio");
      expect(await readFile(unrelatedTemporary, "utf8")).toBe("other-request");
    });

    it("leaves an exclusive-create collision owned by another request intact", async () => {
      const { actualFs, target, temporary, save } = await prepare();
      await actualFs.writeFile(temporary, "another-owner");

      await expect(save()).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(temporary, "utf8")).toBe("another-owner");
      await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});
