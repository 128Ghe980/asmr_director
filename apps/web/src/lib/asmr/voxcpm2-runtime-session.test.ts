import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { renameSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocalRuntimeConfig } from "./local-runtime-config";
import { VoxCpm2Error } from "./voxcpm2-error";
import { withVoxCpm2RuntimeSession, type VoxCpm2RuntimeSession } from "./voxcpm2-runtime-session";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vox-session-test-"));
  roots.push(root);
  return { root, config: getLocalRuntimeConfig({ ASMR_DIRECTOR_RUNTIME_ROOT: root }), lockPath: path.join(root, "locks", "voxcpm2-generation.lock") };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function timedOutSession(config: ReturnType<typeof getLocalRuntimeConfig>) {
  let session!: VoxCpm2RuntimeSession;
  await expect(withVoxCpm2RuntimeSession(config, undefined, async (value) => {
    session = value;
    session.processStarted(123456);
    throw new VoxCpm2Error("Process exit has not been confirmed", 503);
  })).rejects.toMatchObject({ statusCode: 503 });
  return session;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("vox-session-test-")) throw new Error("Unsafe test cleanup target");
    await rm(resolved, { recursive: true, force: true });
  }
});

describe("VoxCPM2 runtime session reservation", () => {
  it.each(["empty", "partial"] as const)("removes its own %s initial reservation after ENOSPC and allows the next session", async (kind) => {
    const { config, lockPath } = await fixture();
    const operation = vi.fn();
    const writeOwnerRecord = vi.fn((fd: number, contents: string) => {
      if (kind === "partial") writeSync(fd, contents.slice(0, 31), 0, "utf8");
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });
    await expect(withVoxCpm2RuntimeSession(config, undefined, operation, { writeOwnerRecord }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE", statusCode: 507 });
    expect(operation).not.toHaveBeenCalled();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(withVoxCpm2RuntimeSession(config, undefined, async () => "next candidate"))
      .resolves.toBe("next candidate");
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["malformed contents", "owner token", "inode"] as const)("preserves a foreign initial reservation after write failure when its %s changed", async (changed) => {
    const { config, lockPath } = await fixture();
    const foreign = changed === "malformed contents" ? '{"ownerToken":"foreign' : JSON.stringify({ ownerToken: "foreign" });
    let replacement = foreign;
    const writeOwnerRecord = (fd: number, contents: string) => {
      if (changed === "inode") {
        renameSync(lockPath, path.join(path.dirname(lockPath), "retired.lock"));
        // Even an exact prefix must not authorize removing a different inode.
        replacement = contents.slice(0, 31);
        writeFileSync(lockPath, replacement);
      } else writeSync(fd, foreign, 0, "utf8");
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    };
    await expect(withVoxCpm2RuntimeSession(config, undefined, async () => {}, { writeOwnerRecord }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_STORAGE", statusCode: 507 });
    const remaining = await readFile(lockPath, "utf8");
    expect(remaining).toBe(replacement);
    expect(remaining).not.toBe("");
    await expect(withVoxCpm2RuntimeSession(config, undefined, async () => {})).rejects.toMatchObject({ statusCode: 409 });
    expect(await readFile(lockPath, "utf8")).toBe(remaining);
  });

  it("keeps a pre-existing malformed lock reserved instead of guessing its owner", async () => {
    const { config, lockPath } = await fixture();
    await withVoxCpm2RuntimeSession(config, undefined, async () => {});
    await writeFile(lockPath, "");
    const operation = vi.fn();
    await expect(withVoxCpm2RuntimeSession(config, undefined, operation)).rejects.toMatchObject({ statusCode: 409 });
    expect(operation).not.toHaveBeenCalled();
    expect(await readFile(lockPath, "utf8")).toBe("");
  });

  it("tracks overlapping TTS and ASR separately and retains a late ASR reservation", async () => {
    const { config, lockPath } = await fixture();
    let session!: VoxCpm2RuntimeSession;
    await withVoxCpm2RuntimeSession(config, undefined, async (value) => {
      session = value;
      session.processStarted(11);
      session.processStarted(22);
      expect(JSON.parse(await readFile(lockPath, "utf8")).childPids).toEqual([11, 22]);
      await session.processExited(11);
      expect(JSON.parse(await readFile(lockPath, "utf8")).childPids).toEqual([22]);
    });
    await expect(withVoxCpm2RuntimeSession(config, undefined, async () => {})).rejects.toMatchObject({ statusCode: 409 });
    await session.processExited(11); // Duplicate TTS close must not retire ASR.
    expect(JSON.parse(await readFile(lockPath, "utf8")).childPids).toEqual([22]);
    await session.processExited(22);
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("finishes scoped worker cleanup before releasing the reservation", async () => {
    const { config, lockPath } = await fixture();
    const cleanup = vi.fn();
    await withVoxCpm2RuntimeSession(config, undefined, async (session) => {
      session.processStarted(22);
      session.onClose!(async () => {
        expect(JSON.parse(await readFile(lockPath, "utf8")).childPids).toEqual([22]);
        cleanup();
        await session.processExited(22);
      });
    });
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("blocks another request for the whole operation, including intervals without a running child", async () => {
    const { root, config, lockPath } = await fixture();
    const started = deferred();
    const finish = deferred();
    const pending = withVoxCpm2RuntimeSession(config, undefined, async (session) => {
      session.processStarted(123456);
      await session.processExited();
      started.resolve();
      await finish.promise;
    });
    await started.promise;
    const owner = JSON.parse(await readFile(lockPath, "utf8"));
    expect(owner).toMatchObject({ ownerPid: process.pid, childPid: null });
    const competitor = vi.fn();
    try {
      await expect(withVoxCpm2RuntimeSession(config, undefined, competitor)).rejects.toMatchObject({ statusCode: 409 });
      expect(competitor).not.toHaveBeenCalled();
    } finally { finish.resolve(); await pending; }
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });

  it("retains the lock while exit is uncertain and releases it when the child exits after the caller has failed", async () => {
    const { root, config, lockPath } = await fixture();
    const session = await timedOutSession(config);
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({ childPid: 123456 });
    const competitor = vi.fn();
    await expect(withVoxCpm2RuntimeSession(config, undefined, competitor)).rejects.toMatchObject({ statusCode: 409 });
    expect(competitor).not.toHaveBeenCalled();
    await session.processExited();
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
    await expect(withVoxCpm2RuntimeSession(config, undefined, async () => "next candidate")).resolves.toBe("next candidate");
  });

  it.each(["owner token", "inode"] as const)("does not remove a replaced lock when its %s no longer belongs to the late session", async (changed) => {
    const { config, lockPath } = await fixture();
    const session = await timedOutSession(config);
    const original = await readFile(lockPath, "utf8");
    const originalStat = await stat(lockPath, { bigint: true });
    if (changed === "owner token") {
      await writeFile(lockPath, JSON.stringify({ ...JSON.parse(original), ownerToken: "another-request" }));
      expect((await stat(lockPath, { bigint: true })).ino).toBe(originalStat.ino);
    } else {
      await rename(lockPath, path.join(path.dirname(lockPath), "retired.lock"));
      await writeFile(lockPath, original);
      expect((await stat(lockPath, { bigint: true })).ino).not.toBe(originalStat.ino);
    }
    const replacement = await readFile(lockPath, "utf8");
    await session.processExited();
    expect(await readFile(lockPath, "utf8")).toBe(replacement);
  });

  it("ignores a duplicate late exit after the next request has acquired its own lock", async () => {
    const { root, config, lockPath } = await fixture();
    const previous = await timedOutSession(config);
    await previous.processExited();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    const started = deferred();
    const finish = deferred();
    const next = withVoxCpm2RuntimeSession(config, undefined, async (session) => {
      session.processStarted(654321);
      started.resolve();
      await finish.promise;
      await session.processExited();
    });
    await started.promise;
    try {
      const owner = await readFile(lockPath, "utf8");
      await previous.processExited();
      expect(await readFile(lockPath, "utf8")).toBe(owner);
      expect(JSON.parse(owner).childPid).toBe(654321);
    } finally { finish.resolve(); await next; }
    expect(await readdir(path.join(root, "locks"))).toEqual([]);
  });
});
