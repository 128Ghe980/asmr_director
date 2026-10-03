export const INSUFFICIENT_STORAGE = "INSUFFICIENT_STORAGE";

/** Safe to share between the server, streaming client and batch coordinator. */
export class LocalStorageError extends Error {
  readonly code = INSUFFICIENT_STORAGE;
  readonly statusCode = 507;

  constructor() {
    super("音频保存空间不足，请释放存储空间后重试。");
    this.name = "LocalStorageError";
  }
}

export function getLocalStorageError(error: unknown): LocalStorageError | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    if (current instanceof LocalStorageError) return current;
    seen.add(current);
    const value = current as { code?: unknown; cause?: unknown };
    if (value.code === INSUFFICIENT_STORAGE || value.code === "ENOSPC" || value.code === "EDQUOT") {
      return new LocalStorageError();
    }
    current = value.cause;
  }
  return undefined;
}
