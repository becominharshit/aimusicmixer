from __future__ import annotations

import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import compat_router
from app.api.v1 import router as v1_router
from app.core.config import settings
from app.services import session_store


@asynccontextmanager
async def lifespan(_: FastAPI):
    session_store.purge_expired()
    shutil.rmtree(Path(tempfile.gettempdir()) / "mixbench_uploads", ignore_errors=True)
    yield


app = FastAPI(
    title="MixBench DSP & AI Mentor API",
    version="1.0.0",
    description="Privacy-first deterministic music mix & mastering telemetry backend.",
    lifespan=lifespan,
)

cors_origins = settings.cors_origin_list
allow_all_origins = "*" in cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else cors_origins,
    allow_origin_regex=None if allow_all_origins else (settings.allowed_origin_regex.strip() or None),
    allow_credentials=not allow_all_origins,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "mixbench-dsp"}


app.include_router(v1_router)
app.include_router(compat_router)
