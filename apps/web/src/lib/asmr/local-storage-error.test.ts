import { describe, expect, it } from "vitest";
import { getLocalStorageError, INSUFFICIENT_STORAGE, LocalStorageError } from "./local-storage-error";

describe("storage failure classification", () => {
  it.each(["ENOSPC", "EDQUOT", INSUFFICIENT_STORAGE])("recognizes %s without exposing filesystem paths", (code) => {
    const error = getLocalStorageError({ code, message: "write failed at a private path" });
    expect(error).toBeInstanceOf(LocalStorageError);
    expect(error?.message).toBe("音频保存空间不足，请释放存储空间后重试。");
    expect(error?.statusCode).toBe(507);
  });

  it("preserves a classified error and follows wrapped causes", () => {
    const error = new LocalStorageError();
    expect(getLocalStorageError(error)).toBe(error);
    expect(getLocalStorageError({ cause: { cause: { code: "ENOSPC" } } })).toBeInstanceOf(LocalStorageError);
  });

  it("ignores unrelated errors and terminates cyclic causes", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(getLocalStorageError(cyclic)).toBeUndefined();
    expect(getLocalStorageError({ code: "EACCES" })).toBeUndefined();
    expect(getLocalStorageError(new Error("generation failed"))).toBeUndefined();
    expect(getLocalStorageError(null)).toBeUndefined();
  });
});
