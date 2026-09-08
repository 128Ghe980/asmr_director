import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
