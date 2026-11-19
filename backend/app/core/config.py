from __future__ import annotations

import tempfile
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_sample_assets_dir() -> Path:
    repo_root = Path(__file__).resolve().parents[3] / "assets" / "test-audio"
    if repo_root.exists():
        return repo_root
    return Path(__file__).resolve().parents[2] / "assets" / "test-audio"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    allowed_origins: str = ""
    allowed_origin_regex: str = r"^https://[a-zA-Z0-9-]+\.vercel\.app$"
    cors_origins: str = "*"
    max_single_file_mb: int = 50
    max_stem_total_mb: int = 150
    session_ttl_minutes: int = 60
    max_disk_sessions: int = 15
    rate_limit_max_requests: int = 30
    rate_limit_auth_max_requests: int = 90
    rate_limit_window_seconds: int = 60
    tmp_sessions_dir: Path = Path(tempfile.gettempdir()) / "mixbench_sessions"
    sample_assets_dir: Path = _default_sample_assets_dir()

    gemini_api_key: str = ""
    gemini_model: str = "gemini-4-hydrogen"
    supabase_jwt_secret: str = ""

    @field_validator("gemini_model", mode="before")
    @classmethod
    def _upgrade_deprecated_gemini_model(cls, value: str | None) -> str:
        raw = (value or "").strip()
        if not raw or raw == "gemini-2.5-flash":
            return "gemini-4-hydrogen"
        return raw

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.allowed_origins.strip() or self.cors_origins.strip() or "*"
        if raw == "*":
            return ["*"]
        origins = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
        return origins or ["*"]

    @property
    def max_single_file_bytes(self) -> int:
        return self.max_single_file_mb * 1024 * 1024

    @property
    def max_stem_total_bytes(self) -> int:
        return self.max_stem_total_mb * 1024 * 1024


settings = Settings()
