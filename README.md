# MixBench — Privacy-First Music Mix & Mastering Learning Platform

**MixBench v1.0** | *Learn mixing and mastering by doing mixing and mastering, with meaningful insights from AI.*

---

## 1. Overview & Non-Negotiable Principles

MixBench is an educational acoustic telemetry workbench that pairs a **deterministic Python DSP engine** (`soundfile`, `scipy.signal`, `numpy`, `pyloudnorm`, `ffmpeg`) with a **daylight-first Next.js 15 + Web Audio studio frontend** and an **opt-in Gemini Mentor**. It is built to help artists hear, diagnose, fix, and verify mix issues inside their own DAW rather than automating creative decisions away.

- **Zero AI Stem Separation:** Stem diagnostics (`POST /api/analyze/stems` / `POST /api/v1/sessions/{id}/stems`) are locked on stereo mixdowns (`has_user_stems === false`). MixBench never runs synthetic source separation (Demucs/Spleeter) or invents instrument-specific blame; stem overlap & phase interaction unlock only when you upload 2–8 aligned original stems.
- **Deterministic DSP First:** All ITU-R BS.1770 LUFS, LRA, $4\times$ polyphase True Peak (`dBTP`), sample peaks, clipping timestamps, PLR/PSR/Crest dynamics, rolling stereo phase correlation, and 6-band Welch spectral tilt are computed deterministically in Python—never fabricated by an LLM.
- **Two Modes, One Engine:** *Simple Mix Check* (plain-language hero takeaway + Top 3 prioritized cards following *What happened → Why it matters → Listen → What to try → Recheck*) and *Advanced Mix Check* (interactive waveform pins, telemetry cards, 6-band genre reference envelope, short-term loudness timeline, stereo phase correlation meter) share the exact same canonical `AnalysisReport` JSON schema.
- **Three-Tier Granular Privacy Consent:**
  1. **Numerical DSP Metrics & Evidence IDs** (Default `OFF`): transmits only sanitized numerical JSON + `evidence_id` tags—zero raw audio leaves the session.
  2. **Direct Audio Snippet Analysis** (Default `OFF`): separate explicit opt-in required before extracting a compressed 25s clip for Gemini multimodal inspection.
  3. **Model Training Permission** (Default `OFF`): strictly opt-in; Gemini calls use `store=false` (ephemeral API processing is never conflated with zero retention). When AI toggles or keys are unset, an **Offline Deterministic Mentor** runs locally.
- **Honest Generic Translation Checks:** Web Audio `BiquadFilterNode` monitoring (*Bypass Full Range*, *Mono Fold 0.5L + 0.5R*, *Generic Smartphone 300 Hz–4.5 kHz · Mono*, *Generic Laptop 180 Hz–12 kHz*) uses $15\text{ ms}$ exponential `GainNode` ramping (`setTargetAtTime`) to avoid switching clicks and is explicitly framed as an approximate check rather than literal hardware modeling.

---

## 2. System Architecture

```text
+-------------------------------------------------------------------+
| Frontend (Next.js 15 + React 19 + Motion + Web Audio on Vercel)   |
|                                                                   |
|  Upload Stage ──> StudioHeader (Live /health Pill + Mode Toggle)  |
|       │                                                           |
|       ▼                                                           |
|  Workspace Sub-Nav (layoutId transitions)                         |
|   ├── Mix Diagnosis (Simple Mix Check / Advanced Workbench)       |
|   ├── Reference A/B (Auto LUFS Match + Spectral/Dynamic Deltas)   |
|   ├── Original Stems (Locked on Stereo; 2-8 Aligned Stem Matrix)  |
|   └── Revision Check (v1 -> v2 Improved/Unchanged/Regressed)      |
|                                                                   |
|  Persistent Bottom Transport Dock (60fps RAF + BiquadFilterNode)  |
|  Slide-Over AI Mix Mentor Drawer (3 Independent Privacy Toggles)  |
+---------------------------------+---------------------------------+
                                  │ Direct Browser HTTPS Multipart
                                  │ (Bypasses Vercel 4.5 MB Limit)
                                  ▼
+-------------------------------------------------------------------+
| Backend (FastAPI + Python 3.12 + FFmpeg on Railway / HF Spaces)   |
|                                                                   |
|  POST /api/analyze          POST /api/analyze/stems               |
|  POST /api/compare          POST /api/mentor        GET /health   |
|                                                                   |
|  DSP Core: ffprobe -> soundfile (native 44.1/48/96 kHz L/R)       |
|   ├── pyloudnorm (ITU-R BS.1770 LUFS, LRA, Momentary/Short-Term)  |
|   ├── scipy.signal.resample_poly(4x) + ffmpeg ebur128 (dBTP)      |
|   ├── welch + stft (6-Band Relative Tilt & Window Localization)   |
|   └── Pearson Mid/Side Phase Correlation & Plr/Psr/Crest          |
|                                                                   |
|  Ephemeral /tmp Cleanup (try...finally raw upload unlink + TTL)   |
|  Optional Gemini Mentor: google-genai Interactions API (store=False)
+-------------------------------------------------------------------+
```

---

## 3. Repository Structure

```text
├── MASTER.md                      # Visual, telemetry & motion governance
├── PRODUCT.md                     # Product truth & non-negotiable guardrails
├── DESIGN.md                      # Daylight acoustic studio design system
├── backend/                       # FastAPI DSP & Gemini Mentor API
│   ├── Dockerfile                 # python:3.12-slim + ffmpeg (PORT 7860 default)
│   ├── pyproject.toml             # uv / PEP 621 project & tool config
│   ├── requirements.txt           # Pip deployment dependencies
│   ├── railway.json               # Railway Docker deployment config
│   ├── .env.example               # Backend environment variable reference
│   ├── app/
│   │   ├── api/v1/routes.py       # /health, /api/analyze, /api/analyze/stems, /api/compare, /api/mentor
│   │   ├── dsp/                   # ingest, loudness, 4x peaks, dynamics, spectrum, stereo, stems
│   │   ├── rules/                 # Stage/genre deterministic evaluator + v1->v2 revision delta
│   │   ├── ai/mentor.py           # google-genai structured output + offline deterministic fallback
│   │   └── schemas/report.py      # Canonical AnalysisReport v1.0 Pydantic contract
│   ├── scripts/generate_test_audio.py  # Generates assets/test-audio/ & frontend/public/demo/
│   └── tests/                     # DSP math, stem alignment, compare & privacy test suites
├── frontend/                      # Next.js 15 + React 19 + Motion + Recharts
│   ├── public/demo/               # 1-click WAV demo fixtures (demo-flawed-v1.wav, demo-revised-v2.wav)
│   ├── src/audio/                 # StudioAudioEngine.ts (persistent Web Audio graph)
│   ├── src/components/            # Header, Upload, Simple, Advanced, Sub-Nav views, Dock, Mentor Drawer
│   ├── vercel.json                # Vercel frontend preset
│   └── tests/                     # Vitest unit tests & Playwright E2E spec
├── render.yaml                    # Render Docker blueprint
└── start-dev.ps1                  # Concurrent local Windows launcher
```

---

## 4. Local Setup

### Prerequisites
- Python `3.12+` (`uv` recommended, or `pip`)
- Node.js `20+`
- `ffmpeg` and `ffprobe` installed and available on system `PATH`

### Step 1: Configure Environment Variables

Copy the example env files or configure variables cleanly:

- **Backend (`backend/.env`):**
  - `ALLOWED_ORIGINS`: Comma-separated allowed browser origins (e.g., `http://localhost:3000,https://your-app.vercel.app`, or `*`).
  - `GEMINI_API_KEY`: Optional Google Gemini API key. Leave blank to operate strictly with the built-in Offline Deterministic Mentor fallback.
  - `GEMINI_MODEL`: Defaults to `gemini-3.8-flash` (overridable via env var; `gemini-2.5-flash` is substituted with `gemini-3.8-flash` per current Google GenAI SDK model lifecycle guidance).
- **Frontend (`frontend/.env.local`):**
  - `NEXT_PUBLIC_API_URL`: HTTPS/HTTP origin of your FastAPI server (defaults to `http://localhost:8000`).

### Step 2: Run Backend (Port 8000 locally)

```bash
cd backend
uv sync
uv run python scripts/generate_test_audio.py
uv run pytest -v
uv run ruff check app tests
uv run uvicorn app.main:app --reload --port 8000
```

*(Alternatively without `uv`: `pip install -r requirements.txt` and run `uvicorn app.main:app --reload --port 8000`.)*

### Step 3: Run Frontend (Port 3000)

```bash
cd frontend
npm install
npm run typecheck
npm run lint
npm run test
npm run build
npm run dev
```

Open `http://localhost:3000` and click **Try Sample Flawed Mix** right below the upload dropzone (loads `/demo/demo-flawed-v1.wav` via `POST /api/analyze`), or upload any local WAV, FLAC, AIFF, MP3, or OGG file up to 100 MB.

---

## 5. Cloud Deployment

### Frontend (Vercel)
1. Import this repository in [Vercel](https://vercel.com/new) and set **Root Directory** to `frontend`.
2. Set environment variable:
   - `NEXT_PUBLIC_API_URL` = `https://<your-backend-origin>` (no trailing slash)
3. Deploy. Audio files upload directly from the browser to FastAPI over HTTPS, completely bypassing Vercel's 4.5 MB serverless body limit.

### Backend (Railway or Hugging Face Docker Spaces)
`backend/Dockerfile` builds from the repository root (`python:3.12-slim` + `ffmpeg` + `libsndfile1`) and runs `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}`.

- **Hugging Face Spaces (Docker Space):**
  - Select **Docker** Space SDK (uses default port `7860` exposed in `backend/Dockerfile`).
  - Point `Dockerfile` context or copy `backend/Dockerfile` at Space root if hosting backend-only, or set Railway `dockerfilePath: backend/Dockerfile` (already configured in `backend/railway.json` and `render.yaml`).
  - Configure Space/Railway environment variables:
    - `ALLOWED_ORIGINS` = `https://<your-vercel-domain>.vercel.app`
    - `GEMINI_API_KEY` = *(optional)*
    - `GEMINI_MODEL` = `gemini-3.8-flash`

---

## 6. DSP Verification Benchmarks

Verified deterministically via `backend/tests/test_dsp_accuracy.py` and demo fixture telemetry:

- **ITU-R BS.1770 Integrated Loudness & LRA:** Validated against calibrated `-14 dBFS` 1 kHz stereo reference sine (`pyloudnorm` K-weighting matches expected stereo sum `-11.0 ± 1.0 LUFS` and emits 1 s short-term series).
- **$4\times$ Polyphase Inter-Sample True Peak (`dBTP`):** Tested against $\pi/4$-shifted $f_s/4$ quadrature test waveform where discrete sample peak measures `< -1.0 dBFS` while continuous reconstruction exceeds `+0.5 dBTP`; `scipy.signal.resample_poly(up=4)` + FFmpeg `ebur128` catches the inter-sample overshoot reliably.
- **Native Sample-Rate & Phase Preservation:** $96\text{ kHz}$ 24-bit WAV fixtures preserve $16\text{ kHz}$ energy cleanly in the `air` band without mono downmixing; anti-phase stereo signals measure `<= -0.99` Pearson correlation; digital silence is safely floored at `-70.0 LUFS` / `-120.0 dBFS`.
- **Calibrated Demo Fixtures (`frontend/public/demo/`):**
  - `demo-flawed-v1.wav` (44.1 kHz, 12.0s): `+0.00 dBTP` clipping alert, `-0.27` phase correlation cancellation, and `+7.18 dB` 250–800 Hz buildup.
  - `demo-revised-v2.wav` (44.1 kHz, 12.0s): `-4.20 dBTP` headroom restored, `+0.80` mono-safe correlation, and low-mid congestion cleared cleanly in `v1 -> v2` comparison.
