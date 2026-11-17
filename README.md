# MixBench — Privacy-First Music Mix & Mastering Learning Platform

**AARAMBHATHON 2.0** | *Learn mixing and mastering by doing mixing and mastering, with meaningful insights from AI.*

## Overview

MixBench pairs a **deterministic Python DSP telemetry engine** (`pyloudnorm`, `scipy.signal.resample_poly`, `welch`, `soundfile`, `ffmpeg`) with a **daylight-first Next.js 15 + Web Audio studio workbench** and **opt-in Gemini structured-output mentoring**.

- **Zero AI Stem Separation:** Stem overlap diagnostics only unlock when the artist uploads 2–8 aligned original stems (`has_user_stems === true`). Stereo mixdowns never fabricate instrument blame.
- **True Peak Accuracy:** Uses ITU-R BS.1770 loudness paired with $4\times$ polyphase FIR oversampling (`scipy.signal.resample_poly`) and FFmpeg `ebur128` verification.
- **Click-Free Web Audio Studio:** Equal-power mono folding ($0.5L + 0.5R$), `15 ms` exponential `GainNode` ramps, loudness-matched A/B reference switching, and explicitly labeled `BiquadFilterNode` device translation approximations (*Full Range*, *Smartphone*, *Laptop*).
- **Three-Tier Granular Consent:** Toggle A (Metrics-Only AI JSON), Toggle B (Multimodal Audio Snippet Opt-In), and Toggle C (Dataset Training Opt-In) are independent controls—all defaulting to `OFF`—backed by an offline deterministic mentor fallback.

## Project Structure

```text
├── MASTER.md                      # Visual, telemetry & motion governance
├── PRODUCT.md                     # Product truth & non-negotiable guardrails
├── DESIGN.md                      # Built daylight design system documentation
├── backend/                       # FastAPI + Python 3.12+ DSP & Gemini Mentor
│   ├── app/
│   │   ├── api/v1/                # /analyze, /stems, /compare, /mentor, /health
│   │   ├── dsp/                   # loudness, 4x peaks, dynamics, spectrum, stereo, stems
│   │   ├── rules/                 # Genre/stage deterministic evaluator + v1/v2 delta
│   │   ├── ai/                    # Gemini structured-output mentor + offline fallback
│   │   └── schemas/report.py      # Canonical AnalysisReport v1.0 Pydantic schema
│   └── tests/                     # Synthetic signal DSP & API integration tests
├── frontend/                      # Next.js 15 + React 19 + Motion + Recharts
│   ├── src/audio/                 # Persistent Web Audio Studio Engine
│   ├── src/components/            # Simple Mix Check, Advanced Workbench, Stems, Privacy
│   └── tests/                     # Vitest unit tests & Playwright E2E journey
├── assets/
│   ├── test-audio/                # Copyright-free generated demo mix, v2, ref & 4 stems
│   └── banners/                   # Architecture & showcase diagrams
└── pitch-deck/                    # 10-slide interactive HTML hackathon presentation
```

## Local Development

### 1. Backend (FastAPI + DSP)
```bash
cd backend
uv sync
uv run python scripts/generate_test_audio.py
uv run pytest -v
uv run ruff check app tests
uv run uvicorn app.main:app --reload --port 8000
```

### 2. Frontend (Next.js 15)
```bash
cd frontend
npm install
npm run typecheck
npm run test
npm run build
npm run dev
```

Open `http://localhost:3000` and click **Load Sample Studio Session** (or upload your own WAV/FLAC/MP3/AIFF/OGG file).

## Deployment

- **Backend:** Deploy via `backend/Dockerfile`, `backend/railway.json` (Railway), or `render.yaml` (Render). Set `CORS_ORIGINS` to your frontend URL and optionally `GEMINI_API_KEY`.
- **Frontend:** Deploy `frontend/` to Vercel (`frontend/vercel.json`) with `NEXT_PUBLIC_API_BASE_URL` pointing directly to the Python FastAPI HTTPS origin (bypassing Vercel's 4.5 MB proxy limit).
