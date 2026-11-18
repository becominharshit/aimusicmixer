import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AnalysisReport, BandName, GlobalMetrics, TimeSeries } from "@/types/report";
import { serverConfig } from "../config";
import type { DynamicsResult } from "../dsp/dynamics";
import { type LoadedAudio, loadAudioFile } from "../dsp/ingest";
import type { LoudnessResult } from "../dsp/loudness";
import type { PeakResult } from "../dsp/peaks";
import type { SpectralAnalysisResult } from "../dsp/spectrum";
import type { StereoResult } from "../dsp/stereo";

export interface CachedDspSnapshot {
  durationSec: number;
  loudness: LoudnessResult;
  peaks: PeakResult;
  dynamics: DynamicsResult;
  spectral: SpectralAnalysisResult;
  stereo: StereoResult;
  bandEnergiesDb: Record<BandName, number>;
}

export interface SessionRecord {
  sessionId: string;
  createdEpoch: number;
  lastAccessedEpoch: number;
  directory: string;
  primaryAudioPath: string | null;
  primaryLoaded: LoadedAudio | null;
  primaryReport: AnalysisReport | null;
  primarySnapshot: CachedDspSnapshot | null;
  revisedAudioPath: string | null;
  revisedReport: AnalysisReport | null;
  referenceAudioPath: string | null;
  proxyFiles: Map<string, string>;
}

export interface DemoMixCacheEntry {
  mtimeMs: number;
  loaded: LoadedAudio;
  snapshot: CachedDspSnapshot;
  globalMetrics: GlobalMetrics;
  timeSeries: TimeSeries;
  proxyBytes: Buffer;
  proxyExt: string;
}

export interface DemoRefCacheEntry {
  mtimeMs: number;
  payloadTemplate: Record<string, unknown>;
  proxyBytes: Buffer;
  proxyName: string;
}

class SessionStore {
  readonly rootDir: string;
  readonly ttlMs: number;
  readonly maxDiskSessions: number;
  private sessions = new Map<string, SessionRecord>();
  private rateBuckets = new Map<string, number[]>();
  readonly demoMixCache = new Map<string, DemoMixCacheEntry>();
  readonly demoRefCache = new Map<string, DemoRefCacheEntry>();

  constructor(rootDir?: string, ttlMinutes?: number, maxDiskSessions?: number) {
    this.rootDir = rootDir ?? serverConfig.tmpSessionsDir;
    this.ttlMs = (ttlMinutes ?? serverConfig.sessionTtlMinutes) * 60 * 1000;
    this.maxDiskSessions = maxDiskSessions ?? serverConfig.maxDiskSessions;
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  checkRateLimit(clientIp: string, bucket: string): { allowed: boolean; retryAfterSec: number } {
    const key = `${clientIp}:${bucket}`;
    const now = Date.now();
    const windowMs = serverConfig.rateLimitWindowSeconds * 1000;
    const limit = serverConfig.rateLimitMaxRequests;
    const hits = (this.rateBuckets.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (hits.length >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
      this.rateBuckets.set(key, hits);
      return { allowed: false, retryAfterSec };
    }
    hits.push(now);
    this.rateBuckets.set(key, hits);
    return { allowed: true, retryAfterSec: 0 };
  }

  async purgeExpired(): Promise<number> {
    const now = Date.now();
    const expired: string[] = [];
    for (const [sid, rec] of this.sessions.entries()) {
      if (now - rec.createdEpoch > this.ttlMs) {
        expired.push(sid);
      }
    }
    for (const sid of expired) {
      await this.deleteSession(sid);
    }

    if (fs.existsSync(this.rootDir)) {
      const children = await fsp.readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
      for (const child of children) {
        if (child.isDirectory() && !this.sessions.has(child.name)) {
          const full = path.join(this.rootDir, child.name);
          const stat = await fsp.stat(full).catch(() => null);
          if (stat && now - stat.mtimeMs > this.ttlMs) {
            await fsp.rm(full, { recursive: true, force: true }).catch(() => undefined);
          }
        }
      }
    }
    return expired.length;
  }

  private async evictRamAndDiskLru(): Promise<void> {
    const cached = Array.from(this.sessions.values()).filter((r) => r.primaryLoaded !== null);
    if (cached.length >= 2) {
      cached.sort((a, b) => a.lastAccessedEpoch - b.lastAccessedEpoch);
      for (const old of cached.slice(0, -1)) {
        old.primaryLoaded = null;
      }
    }

    while (this.sessions.size >= this.maxDiskSessions) {
      const oldest = Array.from(this.sessions.values()).sort(
        (a, b) => a.lastAccessedEpoch - b.lastAccessedEpoch
      )[0];
      if (!oldest) break;
      await this.deleteSession(oldest.sessionId);
    }
  }

  async createSession(): Promise<SessionRecord> {
    await this.purgeExpired();
    await this.evictRamAndDiskLru();

    const sid = `sess_${crypto.randomUUID().replace(/-/g, "")}`;
    const directory = path.join(this.rootDir, sid);
    await fsp.mkdir(directory, { recursive: true });
    const now = Date.now();
    const rec: SessionRecord = {
      sessionId: sid,
      createdEpoch: now,
      lastAccessedEpoch: now,
      directory,
      primaryAudioPath: null,
      primaryLoaded: null,
      primaryReport: null,
      primarySnapshot: null,
      revisedAudioPath: null,
      revisedReport: null,
      referenceAudioPath: null,
      proxyFiles: new Map(),
    };
    this.sessions.set(sid, rec);
    return rec;
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    await this.purgeExpired();
    const rec = this.sessions.get(sessionId) ?? null;
    if (rec) rec.lastAccessedEpoch = Date.now();
    return rec;
  }

  getPrimaryProxyPath(rec: SessionRecord): string | null {
    const candidates = [
      rec.primaryAudioPath,
      rec.proxyFiles.get("proxy.m4a") ?? null,
      rec.proxyFiles.get("proxy.wav") ?? null,
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }

  async getOrReloadPrimaryAudio(rec: SessionRecord): Promise<LoadedAudio | null> {
    rec.lastAccessedEpoch = Date.now();
    if (rec.primaryLoaded) return rec.primaryLoaded;
    const proxyPath = this.getPrimaryProxyPath(rec);
    if (!proxyPath) return null;

    const reloaded = await loadAudioFile(proxyPath);
    const cached = Array.from(this.sessions.values()).filter(
      (r) => r.primaryLoaded !== null && r.sessionId !== rec.sessionId
    );
    if (cached.length >= 2) {
      cached.sort((a, b) => a.lastAccessedEpoch - b.lastAccessedEpoch);
      for (const old of cached.slice(0, -1)) {
        old.primaryLoaded = null;
      }
    }
    rec.primaryLoaded = reloaded;
    return reloaded;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const rec = this.sessions.get(sessionId) ?? null;
    this.sessions.delete(sessionId);
    if (rec) rec.primaryLoaded = null;
    const dir = rec ? rec.directory : path.join(this.rootDir, sessionId);
    const existed = rec !== null || fs.existsSync(dir);
    if (fs.existsSync(dir)) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    return existed;
  }
}

const globalForMixbench = globalThis as unknown as {
  __mixbenchSessionStore?: SessionStore;
};

export const sessionStore =
  globalForMixbench.__mixbenchSessionStore ??
  (globalForMixbench.__mixbenchSessionStore = new SessionStore());
