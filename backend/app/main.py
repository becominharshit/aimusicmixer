from __future__ import annotations

import logging
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import compat_router
from app.api.v1 import router as v1_router
from app.core.config import settings
from app.services import session_store

logger = logging.getLogger(__name__)


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


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    return response


@app.exception_handler(Exception)
async def sanitized_unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error processing %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please retry your request."},
    )


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "mixbench-dsp"}


app.include_router(v1_router)
app.include_router(compat_router)
