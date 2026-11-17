from pathlib import Path

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
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    max_single_file_mb: int = 100
    max_stem_total_mb: int = 350
    session_ttl_minutes: int = 60
    tmp_sessions_dir: Path = Path(__file__).resolve().parents[2] / "tmp_sessions"
    sample_assets_dir: Path = _default_sample_assets_dir()

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_single_file_bytes(self) -> int:
        return self.max_single_file_mb * 1024 * 1024

    @property
    def max_stem_total_bytes(self) -> int:
        return self.max_stem_total_mb * 1024 * 1024


settings = Settings()
