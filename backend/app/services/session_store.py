from __future__ import annotations

import shutil
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import settings
from app.dsp.dynamics import DynamicsResult
from app.dsp.ingest import LoadedAudio, load_audio_file
from app.dsp.loudness import LoudnessResult
from app.dsp.peaks import PeakResult
from app.dsp.spectrum import SpectralAnalysisResult
from app.dsp.stereo import StereoResult
from app.schemas.report import AnalysisReport, BandName, GlobalMetrics, SongSection, TimeSeries


@dataclass
class CachedDspSnapshot:
    """Compact deterministic DSP measurements preserved for instant context re-evaluation."""

    duration_sec: float
    loudness: LoudnessResult
    peaks: PeakResult
    dynamics: DynamicsResult
    spectral: SpectralAnalysisResult
    stereo: StereoResult
    band_energies_db: dict[BandName, float]
    bpm: float | None = None
    sections: list[SongSection] = field(default_factory=list)


@dataclass
class Sha256CachedAnalysis:
    """Deterministic DSP analysis artifact cached by SHA-256 content hash."""

    sha256: str
    duration_sec: float
    sample_rate: int
    channels: int
    bit_depth: int
    waveform_peaks: list[list[float]]
    snapshot: CachedDspSnapshot
    global_metrics: GlobalMetrics
    time_series: TimeSeries
    proxy_bytes: bytes
    proxy_ext: str


@dataclass
class SessionRecord:
    session_id: str
    created_epoch: float
    directory: Path
    owner_user_id: str | None = None
    last_accessed_epoch: float = field(default_factory=time.time)
    primary_audio_path: Path | None = None
    primary_loaded: LoadedAudio | None = None
    primary_report: AnalysisReport | None = None
    primary_snapshot: CachedDspSnapshot | None = None
    revised_audio_path: Path | None = None
    revised_report: AnalysisReport | None = None
    reference_audio_path: Path | None = None
    proxy_files: dict[str, Path] = field(default_factory=dict)


class SessionStore:
    """Thread-safe in-memory + ephemeral disk store with 60m TTL, 2-session RAM cap, 15-session disk LRU cap, and SHA-256 dedup cache."""

    def __init__(
        self,
        root_dir: Path | None = None,
        ttl_minutes: int | None = None,
        max_disk_sessions: int | None = None,
        max_sha256_cache: int = 24,
    ) -> None:
        self._lock = threading.RLock()
        self.root_dir = root_dir or settings.tmp_sessions_dir
        self.ttl_seconds = (ttl_minutes or settings.session_ttl_minutes) * 60
        self.max_disk_sessions = max_disk_sessions or settings.max_disk_sessions
        self.max_sha256_cache = max(1, max_sha256_cache)
        self._sessions: dict[str, SessionRecord] = {}
        self._sha256_cache: OrderedDict[str, Sha256CachedAnalysis] = OrderedDict()
        self.root_dir.mkdir(parents=True, exist_ok=True)

    @property
    def sha256_cache_size(self) -> int:
        with self._lock:
            return len(self._sha256_cache)

    def get_cached_analysis_by_hash(self, sha256_hex: str) -> Sha256CachedAnalysis | None:
        with self._lock:
            entry = self._sha256_cache.get(sha256_hex)
            if entry is not None:
                self._sha256_cache.move_to_end(sha256_hex)
            return entry

    def set_cached_analysis_by_hash(self, sha256_hex: str, entry: Sha256CachedAnalysis) -> None:
        with self._lock:
            self._sha256_cache[sha256_hex] = entry
            self._sha256_cache.move_to_end(sha256_hex)
            while len(self._sha256_cache) > self.max_sha256_cache:
                self._sha256_cache.popitem(last=False)

    def purge_expired(self) -> int:
        with self._lock:
            now = time.time()
            expired = [
                sid
                for sid, rec in self._sessions.items()
                if (now - rec.created_epoch) > self.ttl_seconds
            ]
            for sid in expired:
                self.delete_session(sid)

            # Remove orphaned folders on disk older than TTL
            if self.root_dir.exists():
                for child in self.root_dir.iterdir():
                    if child.is_dir() and child.name not in self._sessions:
                        try:
                            if (now - child.stat().st_mtime) > self.ttl_seconds:
                                shutil.rmtree(child, ignore_errors=True)
                        except OSError:
                            pass
            return len(expired)

    def _evict_ram_and_disk_lru(self) -> None:
        with self._lock:
            # Keep only the most recent 2 raw PCM buffers in RAM to protect 512 MB containers
            cached = [r for r in self._sessions.values() if r.primary_loaded is not None]
            if len(cached) >= 2:
                cached.sort(key=lambda r: r.last_accessed_epoch)
                for old in cached[:-1]:
                    old.primary_loaded = None

            # Keep at most max_disk_sessions (15) directories on disk via LRU eviction
            while len(self._sessions) >= self.max_disk_sessions:
                oldest = min(self._sessions.values(), key=lambda r: r.last_accessed_epoch)
                self.delete_session(oldest.session_id)

    def create_session(self, owner_user_id: str | None = None) -> SessionRecord:
        with self._lock:
            self.purge_expired()
            self._evict_ram_and_disk_lru()

            # Full 128-bit unpredictable session ID
            sid = f"sess_{uuid.uuid4().hex}"
            session_dir = self.root_dir / sid
            session_dir.mkdir(parents=True, exist_ok=True)
            now = time.time()
            rec = SessionRecord(
                session_id=sid,
                created_epoch=now,
                last_accessed_epoch=now,
                directory=session_dir,
                owner_user_id=owner_user_id,
            )
            self._sessions[sid] = rec
            return rec

    def get_session(self, session_id: str) -> SessionRecord | None:
        with self._lock:
            self.purge_expired()
            rec = self._sessions.get(session_id)
            if rec is not None:
                rec.last_accessed_epoch = time.time()
            return rec

    def get_primary_proxy_path(self, rec: SessionRecord) -> Path | None:
        with self._lock:
            candidates: list[Path | None] = [
                rec.primary_audio_path,
                rec.proxy_files.get("proxy.m4a"),
                rec.proxy_files.get("proxy.wav"),
            ]
            for path in candidates:
                if path is not None and path.exists():
                    return path
            return None

    def get_or_reload_primary_audio(self, rec: SessionRecord) -> LoadedAudio | None:
        """
        Return in-memory LoadedAudio if still cached, or automatically reload PCM from
        the persisted primary proxy file on disk if primary_loaded was RAM-evicted.
        """
        with self._lock:
            rec.last_accessed_epoch = time.time()
            if rec.primary_loaded is not None:
                return rec.primary_loaded
            proxy_path = self.get_primary_proxy_path(rec)

        if proxy_path is None:
            return None

        reloaded = load_audio_file(proxy_path)
        with self._lock:
            # Respect 2-session RAM cap before caching back
            cached = [r for r in self._sessions.values() if r.primary_loaded is not None and r.session_id != rec.session_id]
            if len(cached) >= 2:
                cached.sort(key=lambda r: r.last_accessed_epoch)
                for old in cached[:-1]:
                    old.primary_loaded = None
            rec.primary_loaded = reloaded
            return reloaded

    def delete_session(self, session_id: str) -> bool:
        with self._lock:
            rec = self._sessions.pop(session_id, None)
            if rec is not None:
                rec.primary_loaded = None
            session_dir = rec.directory if rec else (self.root_dir / session_id)
            existed = rec is not None or session_dir.exists()
            if session_dir.exists():
                shutil.rmtree(session_dir, ignore_errors=True)
            return existed


session_store = SessionStore()
