import { writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { VoxCpm2Error } from "./voxcpm2-error";

export type VoxCpm2RuntimeSession = {
  runtimeRoot: string;
  processStarted: (pid?: number) => void;
  processExited: () => void | Promise<void>;
};

// Keep the reservation across planning, all TTS takes and CPU alignment. A second
// tab cannot interleave another native job between this candidate's groups.
export async function withVoxCpm2RuntimeSession<T>(
  config: LocalRuntimeConfig,
  signal: AbortSignal | undefined,
  operation: (session: VoxCpm2RuntimeSession) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  const runtimeRoot = path.resolve(config.runtimeRoot);
  const lockPath = path.join(runtimeRoot, "locks", "voxcpm2-generation.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new VoxCpm2Error("VoxCPM2 正在生成，请等待当前候选完成。", 409);
    throw new VoxCpm2Error("无法准备 VoxCPM2 生成目录。", 503);
  });
  let childRunning = false;
  let operationFinished = false;
  let closing: Promise<void> | undefined;
  let identity: { dev: bigint; ino: bigint } | undefined;
  let release: Promise<void> | undefined;
  const owner = { ownerPid: process.pid, ownerToken: randomUUID(), childPid: null as number | null, createdAt: new Date().toISOString() };
  const record = (pid: number | null) => {
    // Pad to a stable size so updating a shorter PID never leaves invalid JSON.
    writeSync(lock.fd, JSON.stringify({ ...owner, childPid: pid }).padEnd(256, " "), 0, "utf8");
  };
  const removeOwnedLock = async () => {
    if (!identity) return;
    const current = await open(lockPath, "r");
    let owned = false;
    try {
      const info = await current.stat({ bigint: true });
      if (info.dev !== identity.dev || info.ino !== identity.ino || info.size > BigInt(4096)) return;
      try {
        owned = JSON.parse(await current.readFile("utf8")).ownerToken === owner.ownerToken;
      } catch { return; }
    } finally { await current.close(); }
    if (owned) await unlink(lockPath);
  };
  const releaseOwnedLock = () => {
    release ??= (async () => {
      for (let attempt = 0; ; attempt++) {
        try { await removeOwnedLock(); return; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return;
          if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    })();
    return release;
  };
  try {
    identity = await lock.stat({ bigint: true });
    record(null);
    signal?.throwIfAborted();
    return await operation({
      runtimeRoot,
      processStarted(pid) { childRunning = true; try { record(pid ?? null); } catch { /* Reservation remains held. */ } },
      processExited() {
        childRunning = false;
        if (!operationFinished) {
          try { record(null); } catch { /* Reservation remains held until session cleanup. */ }
          return;
        }
        // A child can close after its exit-wait deadline and the caller's finally.
        // The original descriptor is closed; verify inode and owner before removal.
        // An unconfirmed/replaced lock stays reserved if cleanup cannot be proven.
        return closing!.then(releaseOwnedLock).catch(() => undefined);
      },
    });
  } finally {
    operationFinished = true;
    closing = lock.close();
    await closing;
    if (!childRunning) await releaseOwnedLock();
  }
}
