import { describe, expect, it, vi } from "vitest";
import { createIndexedProjectLibraryStore, type ProjectLibrarySnapshot } from "./browser-project-storage";

function nativeStore(result?: unknown) {
  const request = { result } as IDBRequest;
  const get = vi.fn(() => request), put = vi.fn(() => request);
  const transaction = { objectStore: () => ({ get, put }) } as unknown as IDBTransaction;
  const close = vi.fn(), begin = vi.fn(() => transaction);
  const db = { transaction: begin, close } as unknown as IDBDatabase;
  const open = { result: db } as IDBOpenDBRequest;
  const adapter = createIndexedProjectLibraryStore({ open: () => open } as unknown as IDBFactory);
  return { adapter, request, get, put, transaction, close, begin, db, open };
}

describe("native project library transactions", () => {
  it.each(["read", "write"] as const)("settles %s only after the enclosing transaction commits", async operation => {
    const snapshot: ProjectLibrarySnapshot = { version: 1, savedAt: 1, text: "saved library" };
    const native = nativeStore(snapshot);
    const result = operation === "read" ? native.adapter.read() : native.adapter.write(snapshot);
    const settled = vi.fn();
    void result.then(settled);
    native.open.onsuccess?.call(native.open, new Event("success"));
    await vi.waitFor(() => expect(native.transaction.oncomplete).toBeTypeOf("function"));
    expect(native.begin).toHaveBeenCalledWith("library", operation === "read" ? "readonly" : "readwrite");
    if (operation === "read") expect(native.get).toHaveBeenCalledWith("current");
    else expect(native.put).toHaveBeenCalledWith(snapshot, "current");
    native.request.onsuccess?.call(native.request, new Event("success"));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(native.close).not.toHaveBeenCalled();
    native.transaction.oncomplete?.call(native.transaction, new Event("complete"));
    await expect(result).resolves.toEqual(operation === "read" ? snapshot : undefined);
    expect(native.close).toHaveBeenCalledOnce();
  });

  it("rejects an open failure before starting a transaction", async () => {
    const native = nativeStore();
    const result = native.adapter.read();
    const assertion = expect(result).rejects.toThrow("Project database could not be opened");
    native.open.onerror?.call(native.open, new Event("error"));
    await assertion;
    expect(native.begin).not.toHaveBeenCalled();
  });

  it("closes a late connection after a blocked open has already failed", async () => {
    const native = nativeStore();
    const result = native.adapter.read();
    const assertion = expect(result).rejects.toThrow("busy in another tab");
    native.open.onblocked?.call(native.open, new Event("blocked") as IDBVersionChangeEvent);
    await assertion;
    native.open.onsuccess?.call(native.open, new Event("success"));
    expect(native.begin).not.toHaveBeenCalled();
    expect(native.close).toHaveBeenCalledOnce();
  });
});
