from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import urllib.request
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import compat_router
from app.api.v1 import router as v1_router
from app.core.config import settings
from app.services import session_store

logger = logging.getLogger("mixbench.keepalive")
KEEP_ALIVE_INTERVAL_SEC = 600.0
KEEP_ALIVE_TIMEOUT_SEC = 10.0


def _ping_health_sync(health_url: str, timeout_sec: float = KEEP_ALIVE_TIMEOUT_SEC) -> int:
    req = urllib.request.Request(
        health_url,
        method="GET",
        headers={"User-Agent": "MixBench-KeepAlive/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout_sec) as response:
        return int(getattr(response, "status", 200))


async def _keep_alive_loop(
    external_url: str,
    interval_sec: float | None = None,
) -> None:
    health_url = f"{external_url.rstrip('/')}/health"
    while True:
        delay = KEEP_ALIVE_INTERVAL_SEC if interval_sec is None else interval_sec
        await asyncio.sleep(delay)
        try:
            status = await asyncio.to_thread(_ping_health_sync, health_url, KEEP_ALIVE_TIMEOUT_SEC)
            logger.info("Keep-alive ping succeeded (%s -> HTTP %s)", health_url, status)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.debug("Keep-alive ping failed silently (%s): %s", health_url, exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    session_store.purge_expired()
    shutil.rmtree(Path(tempfile.gettempdir()) / "mixbench_uploads", ignore_errors=True)
    keep_alive_task: asyncio.Task[None] | None = None
    render_external_url = (os.getenv("RENDER_EXTERNAL_URL") or "").strip()
    if render_external_url:
        keep_alive_task = asyncio.create_task(_keep_alive_loop(render_external_url))
    try:
        yield
    finally:
        if keep_alive_task is not None:
            keep_alive_task.cancel()
            with suppress(asyncio.CancelledError):
                await keep_alive_task


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
    allow_credentials=not allow_all_origins,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "ok", "service": "mixbench-dsp"}


app.include_router(v1_router)
app.include_router(compat_router)
