from __future__ import annotations

import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import settings
from app.dsp.ingest import LoadedAudio
from app.schemas.report import AnalysisReport


@dataclass
class SessionRecord:
    session_id: str
    created_epoch: float
    directory: Path
    primary_audio_path: Path | None = None
    primary_loaded: LoadedAudio | None = None
    primary_report: AnalysisReport | None = None
    revised_audio_path: Path | None = None
    revised_report: AnalysisReport | None = None
    reference_audio_path: Path | None = None
    proxy_files: dict[str, Path] = field(default_factory=dict)


class SessionStore:
    """In-memory + ephemeral disk store with 60-minute TTL and explicit session purge."""

    def __init__(self, root_dir: Path | None = None, ttl_minutes: int | None = None) -> None:
        self.root_dir = root_dir or settings.tmp_sessions_dir
        self.ttl_seconds = (ttl_minutes or settings.session_ttl_minutes) * 60
        self._sessions: dict[str, SessionRecord] = {}
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def purge_expired(self) -> int:
        now = time.time()
        expired = [
            sid
            for sid, rec in self._sessions.items()
            if (now - rec.created_epoch) > self.ttl_seconds
        ]
        for sid in expired:
            self.delete_session(sid)
        # Also remove orphaned folders on disk older than TTL
        if self.root_dir.exists():
            for child in self.root_dir.iterdir():
                if child.is_dir() and child.name not in self._sessions:
                    try:
                        if (now - child.stat().st_mtime) > self.ttl_seconds:
                            shutil.rmtree(child, ignore_errors=True)
                    except OSError:
                        pass
        return len(expired)

    def create_session(self) -> SessionRecord:
        self.purge_expired()
        sid = f"sess_{uuid.uuid4().hex[:10]}"
        session_dir = self.root_dir / sid
        session_dir.mkdir(parents=True, exist_ok=True)
        rec = SessionRecord(
            session_id=sid,
            created_epoch=time.time(),
            directory=session_dir,
        )
        self._sessions[sid] = rec
        return rec

    def get_session(self, session_id: str) -> SessionRecord | None:
        self.purge_expired()
        return self._sessions.get(session_id)

    def delete_session(self, session_id: str) -> bool:
        rec = self._sessions.pop(session_id, None)
        session_dir = rec.directory if rec else (self.root_dir / session_id)
        existed = rec is not None or session_dir.exists()
        if session_dir.exists():
            shutil.rmtree(session_dir, ignore_errors=True)
        return existed


session_store = SessionStore()
