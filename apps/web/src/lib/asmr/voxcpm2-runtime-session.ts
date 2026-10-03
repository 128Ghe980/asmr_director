import { writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import type { LocalRuntimeConfig } from "./local-runtime-config";
import { getLocalStorageError } from "./local-storage-error";
import { VoxCpm2Error } from "./voxcpm2-error";

export type VoxCpm2RuntimeSession = {
  runtimeRoot: string;
  processStarted: (pid?: number) => void;
  processExited: (pid?: number) => void | Promise<void>;
  onClose?: (cleanup: () => Promise<void>) => void;
};

type RuntimeSessionDependencies = { writeOwnerRecord?: (fd: number, content: string) => void };

function writeOwnerRecord(fd: number, content: string): void {
  const bytes = Buffer.from(content, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
    if (written <= 0) throw Object.assign(new Error("Could not write runtime reservation owner"), { code: "EIO" });
    offset += written;
  }
}

// Keep the reservation across planning, all TTS takes and CPU alignment. A second
// tab cannot interleave another native job between this candidate's groups.
export async function withVoxCpm2RuntimeSession<T>(
  config: LocalRuntimeConfig,
  signal: AbortSignal | undefined,
  operation: (session: VoxCpm2RuntimeSession) => Promise<T>,
  dependencies: RuntimeSessionDependencies = {},
): Promise<T> {
  signal?.throwIfAborted();
  const runtimeRoot = path.resolve(config.runtimeRoot);
  const lockPath = path.join(runtimeRoot, "locks", "voxcpm2-generation.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new VoxCpm2Error("VoxCPM2 正在生成，请等待当前候选完成。", 409);
    const storageError = getLocalStorageError(error);
    if (storageError) throw storageError;
    throw new VoxCpm2Error("无法准备 VoxCPM2 生成目录。", 503);
  });
  const children = new Map<number | undefined, number>();
  const cleanups: Array<() => Promise<void>> = [];
  let operationFinished = false;
  let closing: Promise<void> | undefined;
  let identity: { dev: bigint; ino: bigint } | undefined;
  let release: Promise<void> | undefined;
  let initialRecordCompleted = false;
  let initialOwnerRecord: string | undefined;
  const owner = { ownerPid: process.pid, ownerToken: randomUUID(), childPid: null as number | null, createdAt: new Date().toISOString() };
  const record = () => {
    // Pad to a stable size so updating a shorter PID never leaves invalid JSON.
    const childPids = [...children.keys()].filter((pid): pid is number => pid !== undefined);
    const contents = JSON.stringify({ ...owner, childPid: childPids[0] ?? null, childPids }).padEnd(1024, " ");
    if (!initialRecordCompleted) initialOwnerRecord = contents;
    (dependencies.writeOwnerRecord ?? writeOwnerRecord)(lock.fd, contents);
  };
  const removeOwnedLock = async () => {
    if (!identity) return;
    const current = await open(lockPath, "r");
    let owned = false;
    try {
      const info = await current.stat({ bigint: true });
      if (info.dev !== identity.dev || info.ino !== identity.ino || info.size > BigInt(4096)) return;
      const contents = await current.readFile("utf8");
      try { owned = JSON.parse(contents).ownerToken === owner.ownerToken; }
      catch {
        // Only our newly created inode and the exact attempted prefix prove
        // ownership when an initial write ran out of space before valid JSON.
        owned = !initialRecordCompleted && initialOwnerRecord !== undefined
          && initialOwnerRecord.startsWith(contents);
      }
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
    try { record(); initialRecordCompleted = true; }
    catch (error) { throw getLocalStorageError(error) ?? error; }
    signal?.throwIfAborted();
    return await operation({
      runtimeRoot,
      onClose(cleanup) { cleanups.push(cleanup); },
      processStarted(pid) { children.set(pid, (children.get(pid) ?? 0) + 1); try { record(); } catch { /* Reservation remains held. */ } },
      processExited(pid) {
        // Legacy single-child callers omit the PID. Concurrent callers identify
        // their own child so a TTS exit cannot release a still-running ASR job.
        const key = pid ?? (children.size === 1 ? children.keys().next().value : undefined);
        const count = children.get(key);
        if (!count) return;
        if (count === 1) children.delete(key); else children.set(key, count - 1);
        if (!operationFinished) {
          try { record(); } catch { /* Reservation remains held until session cleanup. */ }
          return;
        }
        // A child can close after its exit-wait deadline and the caller's finally.
        // The original descriptor is closed; verify inode and owner before removal.
        // An unconfirmed/replaced lock stays reserved if cleanup cannot be proven.
        if (children.size === 0) return closing!.then(releaseOwnedLock).catch(() => undefined);
      },
    });
  } finally {
    // Persistent CPU analysis is scoped to this candidate and must leave before
    // another candidate can acquire the native runtime reservation.
    await Promise.allSettled(cleanups.map((cleanup) => Promise.resolve().then(cleanup)));
    operationFinished = true;
    closing = lock.close();
    await closing;
    if (children.size === 0) await releaseOwnedLock();
  }
}
