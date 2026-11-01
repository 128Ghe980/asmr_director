import { describe, expect, it, vi } from "vitest";
import { demoProject } from "./mock-project";
import { createInitialProjectLibrary, createProjectRevision, PROJECT_LIBRARY_STORAGE_KEY, replaceLibraryProject } from "./project-library";
import { createBrowserProjectStorage, createIndexedProjectLibraryStore, PROJECT_LIBRARY_BACKUP_KEY,
  type ProjectLibrarySnapshot, type ProjectLibrarySnapshotStore } from "./browser-project-storage";

function storage(initial: Record<string, string> = {}, full = false) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { if (full) throw new Error("Quota exceeded"); values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }) };
}
function database(initial?: unknown) {
  let value = initial;
  return { read: vi.fn(async () => value), write: vi.fn(async (snapshot: ProjectLibrarySnapshot) => { value = structuredClone(snapshot); }) };
}
function snapshot(title: string, savedAt: number): ProjectLibrarySnapshot {
  return { version: 1, savedAt, text: JSON.stringify(createInitialProjectLibrary({ ...demoProject, title })) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe("browser project library persistence", () => {
  it("migrates a full legacy library without losing old projects or revisions when localStorage is full", async () => {
    let library = createInitialProjectLibrary(demoProject);
    for (let i = 1; i < 18; i++) library = replaceLibraryProject(library, { ...demoProject, project_id: `saved_${i}`, title: `Project ${i}` });
    library = createProjectRevision(library, library.currentProjectId);
    const original = JSON.stringify(library), local = storage({ [PROJECT_LIBRARY_STORAGE_KEY]: original }, true), db = database();
    const adapter = createBrowserProjectStorage(local, db);
    const loaded = await adapter.load(demoProject);
    expect(loaded.projects).toHaveLength(18);
    expect(loaded.projects.at(-1)?.revisions).toHaveLength(1);
    await adapter.save(loaded);
    expect(await createBrowserProjectStorage(local, db).load(demoProject)).toEqual(loaded);
    expect(local.values.get(PROJECT_LIBRARY_STORAGE_KEY)).toBe(original);
    expect(local.removeItem).not.toHaveBeenCalled();
  });

  it("serializes saves and captures the requested snapshot before later edits", async () => {
    const first = deferred(), writes: string[] = [];
    const db: ProjectLibrarySnapshotStore = { read: async () => undefined,
      write: async row => { writes.push(JSON.parse(row.text).projects[0].title); if (writes.length === 1) await first.promise; } };
    const adapter = createBrowserProjectStorage(storage(), db), library = createInitialProjectLibrary(demoProject);
    library.projects[0].title = "First";
    const a = adapter.save(library);
    library.projects[0].title = "Second";
    const b = adapter.save(library);
    library.projects[0].title = "Unsubmitted";
    await Promise.resolve();
    expect(writes).toEqual(["First"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(writes).toEqual(["First", "Second"]);
  });

  it("restores a newer local fallback instead of an older successful database snapshot", async () => {
    const db = database(snapshot("Old", 1)), local = storage(), adapter = createBrowserProjectStorage(local, db);
    await adapter.load(demoProject);
    db.write.mockRejectedValueOnce(new Error("Transaction aborted"));
    await adapter.save(createInitialProjectLibrary({ ...demoProject, title: "New" }));
    expect((await createBrowserProjectStorage(local, db).load(demoProject)).projects[0].title).toBe("New");
  });

  it("keeps new fallback edits authoritative if IndexedDB temporarily disappears and returns", async () => {
    const local = storage({ [PROJECT_LIBRARY_BACKUP_KEY]: JSON.stringify(snapshot("Fallback", 5)) });
    const adapter = createBrowserProjectStorage(local);
    expect((await adapter.load(demoProject)).projects[0].title).toBe("Fallback");
    await adapter.save(createInitialProjectLibrary({ ...demoProject, title: "Edited" }));
    expect((await createBrowserProjectStorage(local, database(snapshot("Old IDB", 1))).load(demoProject)).projects[0].title).toBe("Edited");
  });

  it.each(["read-failure", "corrupt-record"])("does not overwrite an unreadable primary library (%s) with the recovery copy", async failure => {
    const original = JSON.stringify(createInitialProjectLibrary({ ...demoProject, title: "Recovery" }));
    const local = storage({ [PROJECT_LIBRARY_STORAGE_KEY]: original }), db = database(failure === "corrupt-record" ? { unexpected: true } : undefined);
    if (failure === "read-failure") db.read.mockRejectedValueOnce(new Error("Cannot read"));
    const adapter = createBrowserProjectStorage(local, db);
    const loaded = await adapter.load(demoProject);
    expect(loaded.projects[0].title).toBe("Recovery");
    await expect(adapter.save(loaded)).rejects.toThrow();
    expect(db.write).not.toHaveBeenCalled();
    expect(local.setItem).not.toHaveBeenCalled();
    expect(local.values.get(PROJECT_LIBRARY_STORAGE_KEY)).toBe(original);
  });

  it("rejects a failed database commit and full fallback without falsely reporting a save", async () => {
    const db = database(), local = storage({}, true);
    db.write.mockRejectedValueOnce(new Error("Aborted"));
    await expect(createBrowserProjectStorage(local, db).save(createInitialProjectLibrary(demoProject))).rejects.toThrow("Quota");
    expect(local.values.size).toBe(0);
  });

  it("waits for transaction completion and rejects an abort after request success", async () => {
    const transaction = { objectStore: () => ({ put: () => request }), error: new Error("Commit aborted") } as unknown as IDBTransaction;
    const request = {} as IDBRequest;
    const close = vi.fn(), db = { transaction: () => transaction, close } as unknown as IDBDatabase;
    const open = { result: db } as IDBOpenDBRequest;
    const factory = { open: () => open } as unknown as IDBFactory;
    const adapter = createIndexedProjectLibraryStore(factory);
    const result = adapter.write(snapshot("Pending", 1));
    let resolved = false;
    void result.then(() => { resolved = true; }, () => {});
    open.onsuccess?.call(open, new Event("success"));
    await vi.waitFor(() => expect(transaction.onabort).toBeTypeOf("function"));
    request.onsuccess?.call(request, new Event("success"));
    await Promise.resolve();
    expect(resolved).toBe(false);
    transaction.onabort?.call(transaction, new Event("abort"));
    await expect(result).rejects.toThrow("Commit aborted");
    expect(close).toHaveBeenCalledOnce();
  });
});
