import type { AsmrProject } from "./schema";
import { loadProjectLibrary, PROJECT_LIBRARY_STORAGE_KEY, type ProjectLibrary } from "./project-library";
import { PROJECT_STORAGE_KEY, type StorageLike } from "./project-persistence";

export const PROJECT_LIBRARY_BACKUP_KEY = "ai-asmr-studio:v2:project-library-backup";
const DATABASE = "ai-asmr-studio-projects";
const STORE = "library";
const KEY = "current";

export type ProjectLibrarySnapshot = { version: 1; savedAt: number; text: string };
export type ProjectLibrarySnapshotStore = {
  read: () => Promise<unknown>;
  write: (snapshot: ProjectLibrarySnapshot) => Promise<void>;
};

export function createIndexedProjectLibraryStore(factory: IDBFactory): ProjectLibrarySnapshotStore {
  async function open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE, 1);
      let settled = false;
      const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = () => fail(request.error ?? new Error("Project database could not be opened."));
      request.onblocked = () => fail(new Error("Project database is busy in another tab."));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  async function transact(mode: IDBTransactionMode, snapshot?: ProjectLibrarySnapshot) {
    const db = await open();
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        let value: unknown;
        const request = mode === "readonly" ? store.get(KEY) : store.put(snapshot, KEY);
        request.onsuccess = () => { value = request.result; };
        // Request success is not durability: an enclosing transaction can still abort.
        transaction.oncomplete = () => resolve(value);
        transaction.onabort = () => reject(transaction.error ?? new Error("Project save was aborted."));
        transaction.onerror = () => reject(transaction.error ?? new Error("Project storage failed."));
      });
    } finally { db.close(); }
  }

  return { read: () => transact("readonly"), write: async snapshot => { await transact("readwrite", snapshot); } };
}

function parseSnapshot(value: unknown): ProjectLibrarySnapshot | undefined {
  if (value === undefined || value === null) return undefined;
  const record = value as Partial<ProjectLibrarySnapshot>;
  if (record.version !== 1 || typeof record.text !== "string" || typeof record.savedAt !== "number" || !Number.isFinite(record.savedAt)) {
    throw new Error("Saved project library is unreadable; its original data has been preserved.");
  }
  const library = JSON.parse(record.text) as Partial<ProjectLibrary>;
  if (library.version !== 1 || !Array.isArray(library.projects) || !library.projects.length) {
    throw new Error("Saved project library is invalid; its original data has been preserved.");
  }
  return record as ProjectLibrarySnapshot;
}

function decodeLibrary(text: string, fallback: AsmrProject, now: Date) {
  const original = JSON.parse(text) as ProjectLibrary;
  const library = loadProjectLibrary({ getItem: key => key === PROJECT_LIBRARY_STORAGE_KEY ? text : null,
    setItem: () => {}, removeItem: () => {} }, fallback, now);
  if (original.version !== 1 || !Array.isArray(original.projects) || library.projects.length !== original.projects.length
    || library.projects.some((entry, i) => entry.projectId !== original.projects[i]?.projectId
      || entry.revisions.length !== (original.projects[i]?.revisions?.length ?? 0))) {
    throw new Error("Some saved projects could not be read; the original library has been preserved.");
  }
  return library;
}

export function createBrowserProjectStorage(storage: StorageLike, database?: ProjectLibrarySnapshotStore) {
  let queue = Promise.resolve();
  let latestTimestamp = 0;
  let readFailure: unknown;
  const enqueue = <T,>(operation: () => Promise<T>) => {
    const result = queue.then(operation);
    queue = result.then(() => {}, () => {});
    return result;
  };

  return {
    async load(fallback: AsmrProject, now = new Date()): Promise<ProjectLibrary> {
      await queue;
      readFailure = undefined;
      const candidates: ProjectLibrarySnapshot[] = [];
      try {
        const backup = storage.getItem(PROJECT_LIBRARY_BACKUP_KEY);
        if (backup) candidates.push(parseSnapshot(JSON.parse(backup))!);
      } catch (error) { readFailure = error; }
      if (database) {
        try { const snapshot = parseSnapshot(await database.read()); if (snapshot) candidates.push(snapshot); }
        catch (error) { readFailure = error; }
      }
      for (const snapshot of candidates.sort((a, b) => b.savedAt - a.savedAt)) {
        latestTimestamp = Math.max(latestTimestamp, snapshot.savedAt);
        try { return decodeLibrary(snapshot.text, fallback, now); }
        catch (error) { readFailure = error; }
      }
      // Read the legacy store without its normalization writes/removals. A full
      // localStorage must never turn a readable library into the demo project.
      try {
        const text = storage.getItem(PROJECT_LIBRARY_STORAGE_KEY);
        if (text) return decodeLibrary(text, fallback, now);
        const legacy = storage.getItem(PROJECT_STORAGE_KEY);
        return loadProjectLibrary({ getItem: key => key === PROJECT_STORAGE_KEY ? legacy : null,
          setItem: () => {}, removeItem: () => {} }, fallback, now);
      } catch (error) { readFailure = error; throw error; }
    },
    save(library: ProjectLibrary): Promise<void> {
      // Capture the complete immutable intent before entering the async queue.
      const snapshot: ProjectLibrarySnapshot = { version: 1,
        savedAt: latestTimestamp = Math.max(Date.now(), latestTimestamp + 1), text: JSON.stringify(library) };
      return enqueue(async () => {
        // A transient failed read is not an empty database. Never overwrite an
        // unknown newer library with a recovered legacy/demo snapshot.
        if (readFailure) throw readFailure;
        if (!database) {
          storage.setItem(PROJECT_LIBRARY_BACKUP_KEY, JSON.stringify(snapshot));
          try { storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, snapshot.text); } catch { /* Backup is durable. */ }
          return;
        }
        try { await database.write(snapshot); }
        catch {
          // Keep the original local library as a recovery copy. Timestamped
          // fallback wins over an older IDB record on the next successful read.
          storage.setItem(PROJECT_LIBRARY_BACKUP_KEY, JSON.stringify(snapshot));
        }
      });
    },
  };
}

const browserStores = new WeakMap<StorageLike, ReturnType<typeof createBrowserProjectStorage>>();
function browserStore(storage: StorageLike) {
  let store = browserStores.get(storage);
  if (!store) {
    let factory: IDBFactory | undefined;
    try { factory = globalThis.indexedDB; } catch { /* Storage fallback still reports any write failure. */ }
    store = createBrowserProjectStorage(storage, factory ? createIndexedProjectLibraryStore(factory) : undefined);
    browserStores.set(storage, store);
  }
  return store;
}

export function loadBrowserProjectLibrary(storage: StorageLike, fallback: AsmrProject, now = new Date()) {
  return browserStore(storage).load(fallback, now);
}

export function saveBrowserProjectLibrary(storage: StorageLike, library: ProjectLibrary) {
  return browserStore(storage).save(library);
}
