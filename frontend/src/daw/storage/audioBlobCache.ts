/**
 * IndexedDB cache for uploaded track audio, keyed by (projectId, trackId).
 *
 * Why: project JSON (tiny) goes to Supabase, but the audio bytes stay on the device. Re-opening a project on the
 * same browser therefore loads instantly with no cloud storage limits. On another device the blobs are missing, and
 * `findMissing()` tells the UI which tracks need to be relinked (re-uploaded).
 */
export interface AudioBlobCache {
  put(projectId: string, trackId: string, blob: Blob): Promise<void>;
  get(projectId: string, trackId: string): Promise<Blob | null>;
  has(projectId: string, trackId: string): Promise<boolean>;
  delete(projectId: string, trackId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  /** Copies every blob of one project to another (used by "duplicate project"). */
  copyProject(fromProjectId: string, toProjectId: string): Promise<void>;
  listTrackIds(projectId: string): Promise<string[]>;
  /** Returns the subset of `trackIds` that has no cached audio, i.e. needs relinking. */
  findMissing(projectId: string, trackIds: string[]): Promise<string[]>;
  /** Total cached bytes for the project (best effort). */
  sizeOfProject(projectId: string): Promise<number>;
}

interface AudioRecord {
  key: string;
  projectId: string;
  trackId: string;
  data: ArrayBuffer;
  type: string;
  size: number;
  savedAt: number;
}

const keyOf = (projectId: string, trackId: string) => `${projectId}::${trackId}`;

// ---------------------------------------------------------------------------
// IndexedDB implementation
// ---------------------------------------------------------------------------

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export interface IndexedDbCacheOptions {
  dbName?: string;
  storeName?: string;
  /** Inject an IDBFactory (e.g. `fake-indexeddb` in tests). Defaults to `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
}

export function createIndexedDbAudioCache(options: IndexedDbCacheOptions = {}): AudioBlobCache {
  const dbName = options.dbName ?? 'mixlearn-daw-audio';
  const storeName = options.storeName ?? 'audio';
  const factory = options.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) throw new Error('IndexedDB is not available in this environment');

  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'key' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('Could not open IndexedDB'));
      };
    });
    return dbPromise;
  };

  const store = async (mode: IDBTransactionMode) => {
    const db = await open();
    const tx = db.transaction(storeName, mode);
    return { tx, os: tx.objectStore(storeName) };
  };

  const recordsOf = async (projectId: string): Promise<AudioRecord[]> => {
    const { os } = await store('readonly');
    return request(os.index('projectId').getAll(projectId)) as Promise<AudioRecord[]>;
  };

  return {
    async put(projectId, trackId, blob) {
      const data = await blob.arrayBuffer(); // read first: a transaction auto-commits if awaited on non-IDB work
      const { tx, os } = await store('readwrite');
      const record: AudioRecord = { key: keyOf(projectId, trackId), projectId, trackId, data, type: blob.type, size: blob.size, savedAt: Date.now() };
      os.put(record);
      await txDone(tx);
    },
    async get(projectId, trackId) {
      const { os } = await store('readonly');
      const rec = (await request(os.get(keyOf(projectId, trackId)))) as AudioRecord | undefined;
      return rec ? new Blob([rec.data], { type: rec.type }) : null;
    },
    async has(projectId, trackId) {
      const { os } = await store('readonly');
      return (await request(os.count(keyOf(projectId, trackId)))) > 0;
    },
    async delete(projectId, trackId) {
      const { tx, os } = await store('readwrite');
      os.delete(keyOf(projectId, trackId));
      await txDone(tx);
    },
    async deleteProject(projectId) {
      const { tx, os } = await store('readwrite');
      const cursorReq = os.index('projectId').openKeyCursor(projectId);
      await new Promise<void>((resolve, reject) => {
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            os.delete(cursor.primaryKey);
            cursor.continue();
          } else resolve();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      await txDone(tx);
    },
    async copyProject(fromProjectId, toProjectId) {
      const records = await recordsOf(fromProjectId);
      if (records.length === 0) return;
      const { tx, os } = await store('readwrite');
      for (const r of records) {
        os.put({ ...r, key: keyOf(toProjectId, r.trackId), projectId: toProjectId, savedAt: Date.now() });
      }
      await txDone(tx);
    },
    async listTrackIds(projectId) {
      return (await recordsOf(projectId)).map((r) => r.trackId);
    },
    async findMissing(projectId, trackIds) {
      const have = new Set(await this.listTrackIds(projectId));
      return trackIds.filter((id) => !have.has(id));
    },
    async sizeOfProject(projectId) {
      return (await recordsOf(projectId)).reduce((n, r) => n + r.size, 0);
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (SSR, tests, private-mode fallbacks)
// ---------------------------------------------------------------------------

export function createMemoryAudioCache(): AudioBlobCache {
  const map = new Map<string, { projectId: string; trackId: string; blob: Blob }>();
  return {
    async put(projectId, trackId, blob) {
      map.set(keyOf(projectId, trackId), { projectId, trackId, blob });
    },
    async get(projectId, trackId) {
      return map.get(keyOf(projectId, trackId))?.blob ?? null;
    },
    async has(projectId, trackId) {
      return map.has(keyOf(projectId, trackId));
    },
    async delete(projectId, trackId) {
      map.delete(keyOf(projectId, trackId));
    },
    async deleteProject(projectId) {
      for (const [k, v] of Array.from(map)) if (v.projectId === projectId) map.delete(k);
    },
    async copyProject(from, to) {
      for (const v of Array.from(map.values())) if (v.projectId === from) map.set(keyOf(to, v.trackId), { ...v, projectId: to });
    },
    async listTrackIds(projectId) {
      return Array.from(map.values())
        .filter((v) => v.projectId === projectId)
        .map((v) => v.trackId);
    },
    async findMissing(projectId, trackIds) {
      return trackIds.filter((id) => !map.has(keyOf(projectId, id)));
    },
    async sizeOfProject(projectId) {
      return Array.from(map.values())
        .filter((v) => v.projectId === projectId)
        .reduce((n, v) => n + v.blob.size, 0);
    },
  };
}

/** IndexedDB when available, otherwise an in-memory cache (audio then lives only for the session). */
export function createAudioBlobCache(options: IndexedDbCacheOptions = {}): AudioBlobCache {
  const hasIdb = options.indexedDB !== undefined || typeof (globalThis as { indexedDB?: unknown }).indexedDB !== 'undefined';
  if (!hasIdb) return createMemoryAudioCache();
  try {
    return createIndexedDbAudioCache(options);
  } catch {
    return createMemoryAudioCache();
  }
}
