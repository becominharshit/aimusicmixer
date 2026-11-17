from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import router as v1_router
from app.core.config import settings
from app.services import session_store


@asynccontextmanager
async def lifespan(_: FastAPI):
    session_store.purge_expired()
    yield


app = FastAPI(
    title="MixBench DSP & AI Mentor API",
    version="1.0.0",
    description="Privacy-first deterministic music mix & mastering telemetry backend.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(v1_router)
