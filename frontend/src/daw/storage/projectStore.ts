import type { AutoSaveStatus, ProjectState, ProjectSummary } from '../types';
import { AUTOSAVE_DELAY_MS } from '../constants';
import { createProjectState, validateProjectState } from '../engine/projectState';
import { nowIso, uid } from '../utils/ids';
import type { AudioBlobCache } from './audioBlobCache';

// ===========================================================================
// Storage adapter contract
// ===========================================================================

/** Minimal persistence contract. Implement it for any backend; adapters for Supabase, localStorage and memory are included. */
export interface ProjectStorageAdapter {
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<ProjectState | null>;
  /** Insert or update (idempotent). */
  upsert(state: ProjectState): Promise<void>;
  remove(id: string): Promise<void>;
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project ${id} was not found`);
    this.name = 'ProjectNotFoundError';
  }
}

const summarize = (s: ProjectState): ProjectSummary => ({
  id: s.id,
  name: s.name,
  updatedAt: s.updatedAt,
  trackCount: s.tracks.length,
});

// ---------------------------------------------------------------------------
// Memory adapter
// ---------------------------------------------------------------------------

export function createMemoryProjectAdapter(): ProjectStorageAdapter {
  const map = new Map<string, string>();
  return {
    async list() {
      return Array.from(map.values())
        .map((j) => summarize(JSON.parse(j) as ProjectState))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id) {
      const j = map.get(id);
      return j ? validateProjectState(JSON.parse(j)) : null;
    },
    async upsert(state) {
      map.set(state.id, JSON.stringify(state));
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// localStorage adapter (offline / guest mode)
// ---------------------------------------------------------------------------

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export function createLocalStorageProjectAdapter(storage?: StorageLike, prefix = 'mixlearn-daw:project:'): ProjectStorageAdapter {
  const store = storage ?? (globalThis as { localStorage?: StorageLike }).localStorage;
  if (!store) throw new Error('localStorage is not available');
  const keys = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  };
  return {
    async list() {
      const items: ProjectSummary[] = [];
      for (const k of keys()) {
        try {
          items.push(summarize(validateProjectState(JSON.parse(store.getItem(k) ?? 'null'))));
        } catch {
          /* skip corrupt entries */
        }
      }
      return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id) {
      const j = store.getItem(prefix + id);
      return j ? validateProjectState(JSON.parse(j)) : null;
    },
    async upsert(state) {
      store.setItem(prefix + state.id, JSON.stringify(state));
    },
    async remove(id) {
      store.removeItem(prefix + id);
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase adapter (structural typing: no hard dependency on @supabase/supabase-js)
// ---------------------------------------------------------------------------

/**
 * Anything shaped like a `SupabaseClient`. Pass the app's existing client: `createSupabaseProjectAdapter(supabase)`.
 * The query builder is typed loosely on purpose so every supabase-js version is assignable.
 */
export interface SupabaseLikeClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface SupabaseAdapterOptions {
  /** Table created by `supabase_daw_projects.sql`. */
  table?: string;
}

interface DbError {
  message: string;
}

function assertOk(res: { error: DbError | null }, action: string): void {
  if (res.error) throw new Error(`Supabase ${action} failed: ${res.error.message}`);
}

/**
 * Persists projects in `daw_projects` (see `supabase_daw_projects.sql`). `user_id` defaults to `auth.uid()` in the
 * database and Row-Level Security restricts every query to the signed-in user, so no user id is sent from the client.
 */
export function createSupabaseProjectAdapter(client: SupabaseLikeClient, options: SupabaseAdapterOptions = {}): ProjectStorageAdapter {
  const table = options.table ?? 'daw_projects';
  return {
    async list() {
      const res = await client.from(table).select('id, name, updated_at').order('updated_at', { ascending: false });
      assertOk(res, 'list');
      const rows = (res.data ?? []) as Array<{ id: string; name: string; updated_at: string }>;
      return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
    },
    async get(id) {
      const res = await client.from(table).select('project_state').eq('id', id).maybeSingle();
      assertOk(res, 'open');
      const row = res.data as { project_state: unknown } | null;
      return row ? validateProjectState(row.project_state) : null;
    },
    async upsert(state) {
      const res = await client
        .from(table)
        .upsert({ id: state.id, name: state.name, updated_at: state.updatedAt, project_state: state }, { onConflict: 'id' });
      assertOk(res, 'save');
    },
    async remove(id) {
      const res = await client.from(table).delete().eq('id', id);
      assertOk(res, 'delete');
    },
  };
}

// ===========================================================================
// Debounced auto-save
// ===========================================================================

export interface AutoSaveSnapshot {
  status: AutoSaveStatus;
  /** True while there are changes that have not been persisted yet. */
  dirty: boolean;
  lastSavedAt: number | null;
  error: string | null;
}

/**
 * Debounced, serialized auto-save: `schedule(state)` after every edit; the save fires 2 s after the last edit.
 * Saves never overlap, and failed saves retry automatically with backoff while changes remain pending.
 */
export class AutoSaver {
  private pending: ProjectState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private failures = 0;
  private disposed = false;
  private snapshot: AutoSaveSnapshot = { status: 'idle', dirty: false, lastSavedAt: null, error: null };
  private readonly listeners = new Set<(s: AutoSaveSnapshot) => void>();

  constructor(
    private readonly save: (state: ProjectState) => Promise<void>,
    private readonly delayMs: number = AUTOSAVE_DELAY_MS,
  ) {}

  getSnapshot = (): AutoSaveSnapshot => this.snapshot;

  subscribe = (listener: (s: AutoSaveSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<AutoSaveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of Array.from(this.listeners)) l(this.snapshot);
  }

  /** Queue `state` for saving (call after every edit). Resets the 2 s debounce window. */
  schedule(state: ProjectState): void {
    if (this.disposed) return;
    this.pending = state;
    this.set({ dirty: true, status: this.snapshot.status === 'saved' || this.snapshot.status === 'error' ? 'idle' : this.snapshot.status });
    this.arm(this.delayMs);
  }

  private arm(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private async run(): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight) {
      // a save is running: wait for it, then re-arm if more changes arrived
      return;
    }
    const state = this.pending;
    if (!state) return;
    this.pending = null;
    this.set({ status: 'saving', error: null });
    this.inFlight = (async () => {
      try {
        await this.save(state);
        this.failures = 0;
        this.set({ status: 'saved', lastSavedAt: Date.now(), dirty: this.pending !== null, error: null });
      } catch (e) {
        this.failures++;
        if (!this.pending) this.pending = state; // keep the changes so a retry can persist them
        this.set({ status: 'error', dirty: true, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    await this.inFlight;
    this.inFlight = null;
    if (this.pending && !this.disposed) {
      const backoff = this.failures > 0 ? Math.min(30_000, 5_000 * 2 ** (this.failures - 1)) : this.delayMs;
      this.arm(backoff);
    }
  }

  /** Persist immediately (e.g. on `visibilitychange`/`pagehide` or before opening another project). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight;
    if (this.pending) await this.run();
  }

  /** Drop pending changes without saving (used when discarding a project). */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.set({ dirty: false, status: 'idle', error: null });
  }

  /** Forget everything about the previous project (called when a different project is opened). */
  reset(): void {
    this.cancel();
    this.failures = 0;
    this.set({ lastSavedAt: null });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

// ===========================================================================
// Project store (lifecycle: new / list / open / save / duplicate / delete)
// ===========================================================================

export interface ProjectStoreOptions {
  adapter: ProjectStorageAdapter;
  /** When provided, duplicate/delete also copy/remove the cached audio blobs. */
  audioCache?: AudioBlobCache;
  autosaveDelayMs?: number;
}

export interface ProjectStore {
  readonly adapter: ProjectStorageAdapter;
  readonly audioCache: AudioBlobCache | undefined;
  /** Creates a project. With `persist: false` it exists only in memory until the first save. */
  createProject(name?: string, options?: { persist?: boolean; sampleRate?: number }): Promise<ProjectState>;
  listProjects(): Promise<ProjectSummary[]>;
  openProject(id: string): Promise<ProjectState>;
  saveProject(state: ProjectState): Promise<void>;
  duplicateProject(id: string, newName?: string): Promise<ProjectState>;
  deleteProject(id: string): Promise<void>;
  /** An auto-saver wired to `saveProject`. */
  createAutoSaver(): AutoSaver;
}

export function createProjectStore(options: ProjectStoreOptions): ProjectStore {
  const { adapter, audioCache } = options;

  const store: ProjectStore = {
    adapter,
    audioCache,

    async createProject(name = 'Untitled Project', opts = {}) {
      const state = createProjectState(opts.sampleRate !== undefined ? { id: uid(), name, sampleRate: opts.sampleRate } : { id: uid(), name });
      if (opts.persist !== false) await adapter.upsert(state);
      return state;
    },

    async listProjects() {
      return adapter.list();
    },

    async openProject(id) {
      const state = await adapter.get(id);
      if (!state) throw new ProjectNotFoundError(id);
      return state;
    },

    async saveProject(state) {
      await adapter.upsert(state);
    },

    async duplicateProject(id, newName) {
      const source = await store.openProject(id);
      const now = nowIso();
      const copy: ProjectState = {
        ...source,
        id: uid(),
        name: newName ?? `${source.name} copy`,
        createdAt: now,
        updatedAt: now,
      };
      await adapter.upsert(copy);
      if (audioCache) await audioCache.copyProject(source.id, copy.id);
      return copy;
    },

    async deleteProject(id) {
      await adapter.remove(id);
      if (audioCache) await audioCache.deleteProject(id);
    },

    createAutoSaver() {
      return new AutoSaver((s) => store.saveProject(s), options.autosaveDelayMs ?? AUTOSAVE_DELAY_MS);
    },
  };
  return store;
}
