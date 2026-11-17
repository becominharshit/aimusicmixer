# Music Mix Analyzer — Revised Six-Phase Master Plan (Hydrogen `xhigh` + Design & Motion Edition)

**Project:** Privacy-First AI-Assisted Music Mix & Mastering Learning Platform  
**Hackathon:** AARAMBHATHON 2.0  
**Motto:** *Learn mixing and mastering by doing mixing and mastering, with meaningful insights from AI.*  
**Development Window:** 48 hours (with a 36-hour reduced-scope contingency)  
**Repository:** `https://github.com/nilabhhu/aarambhathon-sikandar-k-chukandar-project`  
**Primary Build Engine:** **Google Antigravity — Gemini 4 Hydrogen (`xhigh` thinking level)** + **Google AI Studio** *(Zero Claude usage)*  
**Installed Antigravity Skill Stack:** `ui-ux-pro-max` (+ `design-system`, `ui-styling`, `design`, `brand`, `slides`, `banner-design`), `frontend-design`, `emil-design-eng`, `impeccable`, and `uipro` CLI (`v2.15.0`)  
**Status:** Complete Audited Engineering, UI/UX, and Motion Architecture Plan

---

## 0. Technical, UI & Motion Audit Log: Flaws Identified & Corrected

Before executing Phase 1, an end-to-end engineering and design audit resolved six critical bottlenecks across DSP accuracy, browser audio memory, cloud deployment limits, and interface/motion architecture:

| Domain | Flaw in Original Plan | Corrected Architecture & Implementation Standard |
|---|---|---|
| **True Peak ($\text{dBTP}$) DSP** | Relied on `pyloudnorm` for True Peaks. `pyloudnorm` implements ITU-R BS.1770 loudness and LRA, **not** $4\times$ oversampled inter-sample peak detection. | Pair `pyloudnorm` (integrated LUFS & LRA) with **FFmpeg `ebur128=peak=true`** and explicit $4\times$ polyphase FIR oversampling via `scipy.signal.resample_poly(x, up=4, down=1)` to measure true inter-sample $\text{dBTP}$. |
| **Python DSP Bloat & Stereo Loss** | Included `librosa`, which pulls heavy dependencies (`numba`, `llvmlite`) and defaults to $22.05\text{ kHz}$ mono downmixing—destroying stereo phase and high-frequency data. | **Remove `librosa` completely.** Use `soundfile` + `scipy.signal` (`stft`, `welch`, `sosfilt`) + `numpy` + `ffmpeg`. Preserves native sample rates ($44.1/48/96\text{ kHz}$), true L/R phase, and keeps container builds fast. |
| **Vercel $4.5\text{ MB}$ Payload Trap** | Routing WAV/FLAC uploads through Next.js API routes on Vercel fails immediately on files $>4.5\text{ MB}$. | Enforce **direct browser-to-FastAPI HTTPS uploads** (with strict CORS and ephemeral session IDs) to a Python host (Railway, Render, or Google Cloud Run). |
| **Browser RAM Exhaustion on Stems** | Decoding multiple $24\text{-bit}/96\text{ kHz}$ WAV stems via `decodeAudioData` allocates $>200\text{ MB}$ `Float32Array` RAM per stem, crashing browser tabs. | Cap uploads ($100\text{ MB}$/file, max $8$ stems / $350\text{ MB}$ total), generate lightweight $44.1\text{ kHz}$ browser playback proxies via FFmpeg when needed, and stream lossless stems on the backend via `soundfile.blocks()`. |
| **A/B Switching Pops & Mono Clipping** | Naive mono summing ($L + R$) causes $+6\text{ dB}$ digital clipping; instant A/B or filter switching creates audible clicks. | Use equal-power mono folding ($0.5L + 0.5R$) and schedule $15\text{ ms}$ exponential `GainNode` ramps (`gain.setTargetAtTime(target, ctx.currentTime, 0.015)`) on every audio state toggle. |
| **Generic UI & Unstructured Motion** | Basic light tokens without motion choreography, squircle geometry, or skill-enforced layout craft risked "AI dashboard slop" and 60fps canvas jank. | Standardized on global `GEMINI.md` rules: **Daylight-first (`#FAFAFA` / `#F5F5F7` / `#FFFFFF`)**, `1px` tinted hairline borders, `corner-shape: squircle;`, `Plus Jakarta Sans` + `Geist`, and hardware-accelerated `motion/react` springs (`stiffness: 380, damping: 30`) decoupled from Web Audio `requestAnimationFrame` loops. |

---

## 1. Product Vision and Non-Negotiable Requirements

Build a privacy-first music mix and mastering learning workbench with two distinct modes—**Simple Mix Check** and **Advanced Mix Check**—driven by one deterministic DSP engine, one canonical JSON schema, and strict privacy controls.

The platform is **not** an automated "one-click AI mastering" tool that strips creative control from the artist. It teaches musicians to hear, diagnose, fix, and verify their own mixes inside their DAW.

### Twelve Non-Negotiable Product Pillars

1. **Zero AI Stem Separation:** Stem diagnostics operate **exclusively** on original stems or multitracks deliberately uploaded by the user. A stereo mixdown is analyzed strictly at the stereo mix level. No Demucs/Spleeter pipelines, no pseudo-stems, and no invented instrument-specific blame.
2. **Two Interfaces, One Engine:** *Simple Mix Check* provides beginner-friendly, prioritized, genre- and stage-aware coaching; *Advanced Mix Check* reveals full spectral/loudness plots, reference A/B, original-stem overlap analysis, device translation previews, and plugin context.
3. **Genre & Production-Stage Context:** Users select musical genre and stage (**Unmastered Mix** vs. **Final Master**). These contextualize guidance thresholds without altering objective DSP numbers.
4. **Honest Playback-Device Simulation:** Implement practical, explicitly approximate translation profiles (**Smartphone**, **Laptop**, **Mono Fold**) via calibrated Web Audio `BiquadFilterNode` chains—never claiming exact physical replication of specific consumer devices.
5. **Loudness-Matched Reference Comparison:** Support integrated-LUFS level matching, phase-aligned playback, and section-specific A/B switching without treating a reference track as objectively superior.
6. **Artist Vision Without Blind Spots:** Creative profiles (*Punchy*, *Warm*, *Aggressive*, *Wide*, *Dynamic*) inform coaching advice without suppressing objective technical warnings. Creative choice and physical consequence remain distinct.
7. **Permission-Based AI:** By default, the AI Mentor receives **only structured numerical DSP JSON findings**. Direct multimodal audio analysis requires a separate explicit opt-in; external transmission and any retention/training permissions are independent controls.
8. **No Default Model Training:** User audio is never used for training without separate, explicit authorization. Never conflate *no training* with *zero provider retention*.
9. **Learn-by-Doing Pedagogy:** Every actionable finding follows: **What happened** $\rightarrow$ **Why it matters** $\rightarrow$ **Listen** $\rightarrow$ **What to try** $\rightarrow$ **Recheck**.
10. **Daylight-First Studio Craft (Zero AI Slop):** Clean `#FAFAFA` / `#F5F5F7` / `#FFFFFF` daylight surfaces, `1px` tinted borders, `16px–24px` outer / `10px–12px` inner squircle radii, `Plus Jakarta Sans` + `Geist` typography, tactile `motion/react` springs, and real audio telemetry instead of fake "87/100" quality scores.
11. **GitHub as Single Source of Truth:** Every phase concludes with tested, integrated commits pushed to GitHub.
12. **Evidence Over Promises:** Every metric shown in the UI traces back to deterministic DSP via a unique `evidence_id`.

### Core Learning Loop

$$
\text{Mix in DAW} \longrightarrow \text{Analyze} \longrightarrow \text{Understand} \longrightarrow \text{Listen} \longrightarrow \text{Improve} \longrightarrow \text{Verify} \longrightarrow \text{Repeat}
$$

---

## 2. Antigravity Hydrogen (`xhigh`) & Installed Skill Architecture

With **Claude completely excluded**, all coding, UI engineering, motion choreography, and testing run inside **Google Antigravity** using **Gemini 4 Hydrogen (`xhigh`)**, supported by **Google AI Studio** for mathematical DSP verification and Gemini API structured-output testing.

### 2.1 Thinking-Level Allocation for Gemini 4 Hydrogen

| Thinking Level | Assigned Engineering & UI Responsibilities |
|---|---|
| **`Hydrogen xhigh`** *(Primary — ~65%)* | Multi-file system architecture, Pydantic $\leftrightarrow$ TypeScript contract alignment, Python DSP signal-processing pipelines ($4\times$ True Peak, STFT, LUFS), Web Audio API routing graph ($15\text{ ms}$ click-free A/B + `BiquadFilterNode` Device Lab), and `motion/react` shared-layout state synchronization. |
| **`Hydrogen high`** *(~25%)* | Complex interactive views (Advanced Workbench, Interactive Waveform Marker Timeline, Stem Overlap Matrix, Revision Delta Comparison), `pytest` numerical verification, and `Playwright` end-to-end journeys. |
| **`Hydrogen medium / low`** *(~10%)* | Boilerplate scaffolding, `shadcn/ui` & `HeroUI` component installation, `lucide-react` icon wiring, lint/typecheck sweeps, and Markdown documentation updates. |
| **Google AI Studio** *(Gemini 4 Carbon / Argon)* | External mathematical verification of ITU-R BS.1770-5 / filter coefficients and isolated testing of Gemini API JSON schema prompts + audio consent payloads. |

### 2.2 Skill Orchestration Matrix (Global Antigravity Skills)

Every UI and UX task in Antigravity explicitly invokes your installed global skills in a deterministic pipeline so design, motion, and visual polish reinforce one another:

| Installed Skill / CLI | Scope & Trigger Point | Specific Responsibilities in This Project |
|---|---|---|
| **`uipro` CLI (`v2.15.0`) + `ui-ux-pro-max`** (`design-system`, `ui-styling`, `design`, `brand`) | **Phase 1 Initialization** (`uipro init --ai antigravity`) & Token Governance | Generates workspace-local `.agents/skills/ui-ux-pro-max/` and `MASTER.md`. Enforces the daylight-first `#FAFAFA` / `#F5F5F7` / `#FFFFFF` token system, `1px` tinted borders, accessible contrast ratios, and `shadcn/ui` + `HeroUI` component rules across all routes. |
| **`frontend-design`** | **Phases 1, 2, 3, 4** (Layout & Spatial Architecture) | Designs an authentic acoustic-engineering studio layout (inspired by hardware metering & minimalist DAWs) rather than generic SaaS card grids. Establishes asymmetric two-column studio workbench proportions, progressive disclosure between Simple and Advanced modes, and clear data hierarchy. |
| **`emil-design-eng`** | **Phases 2, 3, 4, 5** (Interaction Physics & `motion/react`) | Governs all `motion/react` implementations: snappy spring constants (`stiffness: 380, damping: 30`), `cubic-bezier(0.22, 1, 0.36, 1)` easing, `layoutId` shared-element pills (Mode Switcher, A/B Toggle, Device Lab), interrupted-gesture safety, `tabular-nums` telemetry counters, and strict GPU-only transforms. |
| **`impeccable`** | **End-of-Phase Quality Gate** (Phases 2, 3, 4, 6) | Performs systematic visual & UX critique: audits spacing rhythm, `corner-shape: squircle;` consistency, `1px` border tints, overflow/truncation on mobile & desktop, elimination of redundant labels/AI clutter, and `prefers-reduced-motion` fallback fidelity. |
| **`slides` & `banner-design`** *(via `ui-ux-pro-max`)* | **Phase 6** (Hackathon Deck & Demo Diagrams) | Structures the 10-section AARAMBHATHON 2.0 pitch deck and generates clean architecture/signal-flow diagrams matching the daylight studio aesthetic. |

---

## 3. UI & Visual Design System (`GEMINI.md` + `MASTER.md` Standard)

The visual identity merges precision acoustic instrumentation with calm, daylight-first editorial clarity.

### 3.1 Color Tokens (Daylight-First Palette)

| Token Name | Hex / Value | Role & Usage |
|---|---|---|
| `--bg-canvas` | `#FAFAFA` | Primary application viewport background (soft daylight paper) |
| `--bg-surface` | `#F5F5F7` | Recessed control wells, timeline tracks, inspector sidebars, table headers |
| `--bg-elevated` | `#FFFFFF` | Primary diagnostic cards, active waveform stage, modal dialogs |
| `--border-hairline` | `1px solid rgba(24, 34, 32, 0.08)` | Subtle `1px` tinted borders separating surfaces without heavy drop shadows |
| `--border-active` | `1px solid rgba(58, 114, 105, 0.35)` | Focused controls, active A/B deck, selected issue marker |
| `--text-primary` | `#182220` | Primary headings, metric values, actionable instructions (high WCAG AAA contrast) |
| `--text-secondary` | `#52605D` | Explanatory context, timestamps, axis labels |
| `--accent-primary` | `#3A7269` | Primary interactive actions, active playhead, selected `layoutId` pill |
| `--accent-soft` | `#EBF3F1` | Subtle tinted badge fills and hover states |
| `--status-safe` | `#15803D` | Within genre/stage dynamic & headroom expectations |
| `--status-caution` | `#B45309` | Potential translation concern or noticeable reference divergence |
| `--status-alert` | `#BE123C` | Inter-sample clipping ($\text{dBTP} > -0.1$), severe phase cancellation, or file error |

### 3.2 Typography & Numeric Precision

- **Display & Section Headings:** `Plus Jakarta Sans` (weights `600`, `700`, tight tracking `-0.02em`).
- **UI Body & Coaching Copy:** `Geist` or `DM Sans` (weights `400`, `500`, `600`, comfortable `1.55` line height).
- **Audio Telemetry & Timestamps:** `Geist Mono` with `font-variant-numeric: tabular-nums;` mandatory on all LUFS, $\text{dBTP}$, $\text{Hz}$, LRA, correlation, and `01:24.3` timestamp readouts so live playback counters never jitter horizontally.

### 3.3 Geometry & Component Primitives

- **Squircle Radii System:**
  - Outer workbench containers, dropzones, and modal sheets: `border-radius: 20px;` (`16px–24px` range) + `corner-shape: squircle;`.
  - Inner cards, filter pills, audio buttons, and badge chips: `border-radius: 12px;` (`10px–12px` range) + `corner-shape: squircle;`.
- **Component Foundation:** Built on `shadcn/ui` + `HeroUI` primitives (`Tabs`, `Slider`, `Switch`, `Tooltip`, `Dialog`, `Select`) styled with custom daylight tokens and `lucide-react` / `lucide-animated` icons.
- **Anti-Slop Rule:** Never display arbitrary aggregate scores (e.g., *"Mix Score: 84/100"*), neon waveforms on black backgrounds, or decorative AI illustrations. Every panel earns its space through interactive listening or real measurement evidence.

---

## 4. Motion & Interactivity Engineering Architecture (`emil-design-eng`)

All UI motion uses `motion/react` (Framer Motion) governed by a root `<MotionConfig reducedMotion="user">` provider and engineered for zero audio glitches.

### 4.1 Global Physics & Easing Constants

```ts
// frontend/src/lib/motion.ts
export const STUDIO_SPRING = {
  type: "spring",
  stiffness: 380,
  damping: 30,
  mass: 0.8,
} as const;

export const TACTILE_TAP = {
  scale: 0.97,
  transition: { duration: 0.08, ease: [0.22, 1, 0.36, 1] },
} as const;

export const STUDIO_EASE = [0.22, 1, 0.36, 1] as const;

export const VIEWPORT_REVEAL = {
  once: true,
  amount: 0.2,
} as const;
```

### 4.2 Component-by-Component Motion Choreography

1. **Simple Mode $\leftrightarrow$ Advanced Mode Switcher (`layoutId`):**
   - Uses a shared `layoutId="workspace-mode-pill"` spring (`stiffness: 380, damping: 30`) sliding smoothly across `#F5F5F7` segmented control wells. Switching modes preserves the active audio buffer and playback timestamp without remounting the Web Audio graph.
2. **Audio Upload Dropzone & File Ingestion:**
   - Hover/drag-over triggers a subtle spring scale (`scale: 1.008`) and border tint transition (`--border-active`). Upon drop, an animated upload/DSP stage stepper (`Validating` $\rightarrow$ `Measuring LUFS & True Peak` $\rightarrow$ `Mapping Stereo & Spectrum`) uses `AnimatePresence` with directional vertical slides (`y: 8` $\rightarrow$ `0`, `opacity: 0` $\rightarrow$ `1`).
3. **60fps Waveform Playhead & Marker Pins (Zero React Re-Render Rule):**
   - **Critical Performance Rule:** The moving playback cursor and real-time stereo/LUFS needle are rendered on an HTML5 `<canvas>` / CSS `transform: translate3d(...)` driven directly by `requestAnimationFrame` reading `AudioContext.currentTime`—**never** via `useState` or `motion` React props at 60Hz.
   - Clickable **Issue Marker Pins** along the timeline use `motion.button` with `whileHover={{ scale: 1.15, y: -2 }}` and `whileTap={TACTILE_TAP}`. Clicking a marker seeks the audio playhead smoothly and highlights the corresponding finding card via shared `layoutId="active-issue-indicator"`.
4. **A/B Reference Deck & Mix Translation Lab:**
   - **Original vs. Reference A/B** and **Device Profiles (Full Range / Smartphone / Laptop / Mono)** use tactile `layoutId` pills (`STUDIO_SPRING`) synchronized with $15\text{ ms}$ Web Audio `GainNode` crossfades (`setTargetAtTime`) so visual state transitions and click-free audio transitions feel instantaneous and physical.
5. **Prioritized Finding Cards & "Learn Why" Accordions:**
   - Cards enter with staggered `viewport={{ once: true, amount: 0.2 }}` reveals (`y: 12` $\rightarrow$ `0`, `opacity: 0` $\rightarrow$ `1`, `STUDIO_EASE`).
   - Expanding **What happened $\rightarrow$ Why it matters $\rightarrow$ What to try** animates smoothly via GPU-friendly `clip-path` / `opacity` + `transform` transitions without layout thrashing.
6. **Before/After Revision Delta Badges:**
   - When comparing *Mix v1* vs. *Mix v2*, metric shifts (e.g., `-1.4 dBTP` $\rightarrow$ `-1.1 dBTP`, `+1.8 LU` dynamic improvement) animate with `tabular-nums` spring interpolation and semantic color transitions (`--status-alert` $\rightarrow$ `--status-safe`).

---

## 5. System Architecture, Tech Stack & Canonical Data Contract

### 5.1 Hybrid Browser + Stateless Python DSP Topology

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ BROWSER (Next.js 15 + React 19 + TypeScript + Tailwind + shadcn/HeroUI) │
│  • motion/react (stiffness: 380, damping: 30) + Squircle Daylight UI    │
│  • Web Audio API Engine:                                                │
│     ├─ Equal-Power Mono Folder (0.5L + 0.5R)                            │
│     ├─ 15ms Exponential Gain Ramps (Click-Free A/B & Profile Switching) │
│     └─ BiquadFilterNode Device Lab (Smartphone / Laptop approximations) │
│  • Direct HTTPS Multipart Upload (Bypasses frontend proxy limits)       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ Direct HTTPS (CORS + Session Token)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PYTHON DSP & AI ORCHESTRATION BACKEND (FastAPI + Pydantic v2)           │
│  • FFmpeg / ffprobe: Format validation, ebur128 peak check, 44.1k proxy │
│  • soundfile + NumPy + SciPy:                                           │
│     ├─ pyloudnorm: ITU-R BS.1770 Integrated LUFS & LRA                  │
│     ├─ 4x Polyphase Resampling (resample_poly): True Peak (dBTP)        │
│     ├─ STFT / Welch PSD: Octave-band tonal balance & spectral tilt      │
│     └─ Mid/Side Matrix: Phase correlation & stereo width time-series    │
│  • Deterministic Rule Engine: Genre + Stage contextualized findings     │
│  • Gemini API Mentor (Opt-In): Receives validated DSP JSON by default   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Complete Technology Stack

| Layer | Technologies | Architectural Rationale |
|---|---|---|
| **Frontend Framework** | Next.js (App Router), React, TypeScript | Strict type safety, fast routing, seamless client-side Web Audio persistence |
| **UI & Styling** | Tailwind CSS, `shadcn/ui`, `HeroUI`, `lucide-react`, `lucide-animated` | Daylight-first `#FAFAFA/#F5F5F7/#FFFFFF` palette, `1px` tinted borders, `corner-shape: squircle;` |
| **Motion** | `motion/react` | Snappy springs (`380/30`), `layoutId` transitions, `prefers-reduced-motion` |
| **Audio & Charts** | Web Audio API, HTML5 Canvas (60fps waveform/spectrum), `Recharts` (static analytical charts) | Sample-accurate A/B playback, click-free filter switching, crisp responsive graphs |
| **Backend API** | Python 3.12+, FastAPI, Pydantic v2, Uvicorn | Async file streaming, strict schema validation, automatic OpenAPI docs |
| **DSP Engine** | `FFmpeg`, `pyloudnorm`, `NumPy`, `SciPy`, `soundfile` | Standards-compliant loudness, $4\times$ True Peak, zero `librosa` bloat |
| **AI Integration** | Google Gemini API (`google-genai` SDK) with Structured Outputs | Evidence-bound mentoring from DSP JSON; strictly gated multimodal audio opt-in |
| **Testing & CI** | `pytest`, `Vitest`, `Playwright`, `Ruff`, `ESLint`, GitHub Actions | Numerical DSP accuracy tests against synthetic sine/noise/clipping signals + E2E browser tests |

### 5.3 Canonical `AnalysisReport v1.0` JSON Schema Contract

Both frontend TypeScript interfaces and backend Pydantic v2 models must implement this exact contract in Phase 1:

```json
{
  "schema_version": "1.0.0",
  "report_id": "rep_9f8a7b6c",
  "created_at": "2026-11-17T12:00:00Z",
  "context": {
    "genre": "electronic",
    "stage": "unmastered_mix",
    "artist_vision": ["punchy", "wide"],
    "has_user_stems": false,
    "stem_count": 0
  },
  "audio_metadata": {
    "filename": "track_v1.wav",
    "duration_sec": 194.5,
    "sample_rate_hz": 48000,
    "channels": 2,
    "bit_depth": 24,
    "playback_proxy_url": "/api/v1/sessions/sess_123/proxy.m4a"
  },
  "global_metrics": {
    "integrated_lufs": -16.4,
    "short_term_max_lufs": -12.1,
    "momentary_max_lufs": -10.3,
    "loudness_range_lu": 6.8,
    "sample_peak_dbfs": -1.8,
    "true_peak_dbtp": -1.5,
    "crest_factor_db": 14.6,
    "psr_db": 11.2,
    "phase_correlation_avg": 0.78,
    "stereo_width_ratio": 0.42
  },
  "streaming_estimates": [
    {
      "platform": "Spotify (Normal -14 LUFS)",
      "estimated_gain_db": 2.4,
      "limiter_engaged_warning": true,
      "assumption_note": "Assumes Normal loudness mode (-14 LUFS target). Positive gain (+2.4 dB) would push true peak above -1.0 dBTP; client limiter may reduce peaks."
    }
  ],
  "spectral_bands": [
    { "band": "sub", "range_hz": "20-60", "energy_db": -22.1, "delta_vs_genre_median_db": 1.2 },
    { "band": "low", "range_hz": "60-250", "energy_db": -18.4, "delta_vs_genre_median_db": 3.4 },
    { "band": "low_mid", "range_hz": "250-800", "energy_db": -21.0, "delta_vs_genre_median_db": 0.5 },
    { "band": "high_mid", "range_hz": "800-4000", "energy_db": -23.5, "delta_vs_genre_median_db": -1.1 },
    { "band": "presence", "range_hz": "4000-10000", "energy_db": -26.8, "delta_vs_genre_median_db": -0.8 },
    { "band": "air", "range_hz": "10000-20000", "energy_db": -34.2, "delta_vs_genre_median_db": -1.5 }
  ],
  "time_series": {
    "step_sec": 1.0,
    "short_term_lufs": [-24.1, -18.2, -14.5],
    "phase_correlation": [0.92, 0.81, 0.45]
  },
  "findings": [
    {
      "evidence_id": "ev_low_buildup_01",
      "category": "tonal_balance",
      "severity": "caution",
      "confidence": "measured",
      "title": "Low-End Buildup Around 60–250 Hz",
      "timestamp_start_sec": 64.0,
      "timestamp_end_sec": 82.0,
      "measured_value": "+3.4 dB above genre reference range",
      "what_happened": "Energy between 60 Hz and 250 Hz rises +3.4 dB above typical electronic unmastered mixes during the main drop.",
      "why_it_matters": "Excess low-end energy consumes headroom early and can sound muddy or boomy on laptop and phone speakers.",
      "listen_prompt": "Jump to 01:04 and toggle the Laptop and Smartphone translation previews to hear if the kick and bass blur together.",
      "what_to_try": "Check high-pass filters on non-bass elements around 100–140 Hz or apply a gentle 1.5–2.5 dB dynamic EQ dip near 140 Hz.",
      "recheck_target": "Re-export and verify 60–250 Hz band energy moves closer to 0 to +1.5 dB relative balance."
    }
  ],
  "stem_analysis": null,
  "revision_comparison": null,
  "privacy_audit": {
    "raw_audio_sent_to_ai": false,
    "external_ai_enabled": false,
    "training_opt_in": false,
    "retention_policy": "Ephemeral session storage; deleted automatically after 60 minutes or manual session clear."
  }
}
```

---

## 6. Six-Phase Implementation Roadmap (48-Hour Target & 36-Hour Contingency)

| Phase | Name | Window | Duration | Primary Antigravity Skills & Thinking Level |
|---|---|---|---|---|
| **1** | Design System, Schemas & Repo Foundation | Hours 0–5 | **5 h** | `uipro` CLI + `ui-ux-pro-max` + `frontend-design` (`Hydrogen xhigh`) |
| **2** | Core Python DSP Engine & Simple Mix Check | Hours 5–13 | **8 h** | `frontend-design` + `emil-design-eng` + `impeccable` (`Hydrogen xhigh`) |
| **3** | Advanced Workbench & Playback Translation Lab | Hours 13–23 | **10 h** | `frontend-design` + `emil-design-eng` + `impeccable` (`Hydrogen xhigh`) |
| **4** | User-Provided Stems & Revision Delta Tracking | Hours 23–32 | **9 h** | `emil-design-eng` + `impeccable` (`Hydrogen xhigh` / `high`) |
| **5** | AI Mentor, Artist Vision & Granular Consent | Hours 32–41 | **9 h** | `frontend-design` + `emil-design-eng` + AI Studio (`Hydrogen xhigh`) |
| **6** | Validation, Deployment & Pitch Deck | Hours 41–48 | **7 h** | `impeccable` + `slides` + `banner-design` (`Hydrogen high` / `medium`) |

---

### Phase 1 — Design System, Schemas & Repo Foundation (Hours 0–5)

**Model & Skills:** `Gemini 4 Hydrogen (xhigh)` + `uipro init --ai antigravity` + `ui-ux-pro-max` (`design-system`, `ui-styling`) + `frontend-design`.

**Engineering, UI & Motion Tasks:**
1. Verify GitHub repository permissions (`main` + `dev` branches) and initialize monorepo layout (`frontend/` and `backend/`).
2. Run `uipro init --ai antigravity` in project root to generate `.agents/skills/ui-ux-pro-max/` and `MASTER.md` aligned with global `GEMINI.md` rules (`#FAFAFA` / `#F5F5F7` / `#FFFFFF`, `1px` tinted borders, `corner-shape: squircle;`, `Plus Jakarta Sans` + `Geist`).
3. Install frontend packages: `motion`, `lucide-react`, `recharts`, and initialize `shadcn/ui` + `HeroUI` primitives.
4. Create `frontend/src/lib/motion.ts` with `STUDIO_SPRING` (`380/30`), `STUDIO_EASE`, `TACTILE_TAP`, `VIEWPORT_REVEAL`, and root `<MotionConfig reducedMotion="user">`.
5. Define identical Pydantic v2 (`backend/app/schemas/report.py`) and TypeScript (`frontend/src/types/report.ts`) models matching `AnalysisReport v1.0`.
6. Scaffold FastAPI `/api/v1/health` and `/api/v1/analyze/mock` endpoints with strict CORS for direct browser-to-backend requests.
7. Build the top studio navigation bar with the animated `layoutId="workspace-mode-pill"` switcher between **Simple Mix Check** and **Advanced Mix Check**, rendering realistic mock report data.

**Completion Gate:**
- [ ] `MASTER.md` and `.agents/skills/` initialized cleanly.
- [ ] Frontend & FastAPI backend run locally and exchange typed `AnalysisReport v1.0` JSON.
- [ ] Mode switcher animates smoothly with `motion/react` springs and respects `prefers-reduced-motion`.
- [ ] Initial CI checks (`Ruff`, `pytest`, `ESLint`, `tsc`) pass and commit pushes to GitHub.

---

### Phase 2 — Core Python DSP Engine & Simple Mix Check (Hours 5–13)

**Model & Skills:** `Gemini 4 Hydrogen (xhigh)` + `frontend-design` + `emil-design-eng` + `impeccable` (End-of-Phase Audit).

**Engineering, UI & Motion Tasks:**
1. Implement safe direct file ingestion (`WAV`, `FLAC`, `MP3`, `AIFF`, `OGG` up to $100\text{ MB}$) using `ffprobe` validation and bounded temp-file cleanup.
2. Build deterministic DSP modules in `backend/app/dsp/`:
   - `loudness.py`: Integrated LUFS, Short-Term LUFS series, Momentary Max, and LRA via `pyloudnorm` (ITU-R BS.1770).
   - `peaks.py`: Sample peak ($\text{dBFS}$), clipping event timestamps, and $4\times$ polyphase oversampled True Peak ($\text{dBTP}$) via `scipy.signal.resample_poly` + FFmpeg `ebur128` cross-check.
   - `dynamics.py`: Crest factor and PSR (Peak-to-Short-Term Loudness Ratio).
   - `spectrum.py`: 6-band octave energy profile (`20–60 Hz` through `10–20 kHz`) via `scipy.signal.welch`.
   - `stereo.py`: Mid/Side energy ratio and rolling Pearson phase correlation ($-1.0$ to $+1.0$).
3. Implement Spotify Normal (`-14 LUFS`) playback gain estimation with explicit peak-limiting warnings.
4. Build the deterministic genre- and stage-aware rule engine (`backend/app/rules/evaluator.py`) generating prioritized findings with `evidence_id` tags.
5. Build **Simple Mix Check UI**:
   - Squircle drag-and-drop upload zone (`20px` radius) with genre & stage (`Unmastered Mix` / `Final Master`) selectors.
   - Animated multi-stage DSP progress stepper (`AnimatePresence`).
   - Top 3 prioritized Finding Cards (`viewport={{ once: true, amount: 0.2 }}`) following **What happened $\rightarrow$ Why it matters $\rightarrow$ Listen $\rightarrow$ What to try $\rightarrow$ Recheck**, plus expandable "Learn why" drawers and inline timestamp audition buttons.
6. Run `impeccable` skill audit on Simple Mode spacing, border tints, typography hierarchy, and mobile responsiveness.

**Completion Gate:**
- [ ] Real WAV/MP3 files upload directly to FastAPI and return verified DSP metrics.
- [ ] $4\times$ True Peak ($\text{dBTP}$) and LUFS pass synthetic test-signal verification in `pytest`.
- [ ] Simple Mix Check displays the top 3 prioritized findings with working audio playback.
- [ ] `impeccable` visual polish audit completed and committed.

---

### Phase 3 — Advanced Workbench & Playback Translation Lab (Hours 13–23)

**Model & Skills:** `Gemini 4 Hydrogen (xhigh)` + `frontend-design` + `emil-design-eng` + `impeccable`.

**Engineering, UI & Motion Tasks:**
1. Build the **Web Audio Studio Engine** (`frontend/src/audio/StudioAudioEngine.ts`):
   - Sample-locked playback of Primary Mix and Optional Reference Track.
   - Integrated-LUFS loudness matching between Primary and Reference tracks.
   - $15\text{ ms}$ exponential `GainNode` ramps (`setTargetAtTime`) for click-free A/B switching, Mono folding ($0.5L + 0.5R$), and Device Lab filter changes.
   - **Mix Translation Lab** `BiquadFilterNode` chains:
     - *Full Range (Bypass)*
     - *Smartphone Approximation* (High-pass at $280\text{ Hz}$, midrange presence bump $+2.5\text{ dB}$ at $2.2\text{ kHz}$, low-pass at $11\text{ kHz}$, summed to mono—explicitly labeled as an educational approximation).
     - *Laptop Speaker Approximation* (High-pass at $160\text{ Hz}$, low-pass at $14\text{ kHz}$, narrowed stereo width).
2. Build **Advanced Mix Check Workbench** (`frontend-design` asymmetric studio layout):
   - **60fps Canvas Waveform Stage** decoupled from React state, overlaid with interactive `motion` Issue Marker Pins and loop-region selection.
   - **Tactile Transport & Translation Deck**: `layoutId` segmented pills for `Mix A` / `Reference B`, `Stereo` / `Mono`, and `Full` / `Phone` / `Laptop` previews, accompanied by `tabular-nums` live telemetry readouts.
   - **Diagnostic Charts**: 6-band Tonal Balance vs. Genre Envelope, Short-Term LUFS Timeline, and Stereo Phase Correlation Meter (`Recharts` / Canvas styled with daylight `#FAFAFA` / `#3A7269` tokens).
3. Run `impeccable` audit to ensure Advanced Mode remains crisp, airy, and uncluttered despite high data density.

**Completion Gate:**
- [ ] Clicking any timeline marker seeks smoothly and highlights its corresponding finding card.
- [ ] A/B reference switching, Mono folding, and Device Lab filters toggle with zero audio clicks/pops.
- [ ] Reference track auto-matches integrated LUFS to prevent "louder sounds better" bias.
- [ ] Zero React re-render drops during 60fps waveform playback.

---

### Phase 4 — User-Provided Stems & Mix Revision Tracking (Hours 23–32)

**Model & Skills:** `Gemini 4 Hydrogen (xhigh)` + `emil-design-eng` + `impeccable`.

**Engineering, UI & Motion Tasks:**
1. Build multi-file **Original Stem Upload** (`2–8` user-supplied stems, max $350\text{ MB}$ total) with strict alignment checks (duration tolerance $\le 50\text{ ms}$, sample-rate normalization, channel validation). Reject or warn clearly on misaligned stems.
2. Implement backend stem diagnostics (`backend/app/dsp/stems.py`):
   - Per-stem LUFS, peak headroom, and spectral centroid.
   - Pairwise frequency-band overlap matrix (flagging *potential* spectral masking between user-named stems like `Kick.wav` and `Bass.wav` without claiming definitive psychoacoustic masking).
   - Stereo mix vs. stem-sum residual comparison (noting expected differences from master-bus compression/saturation).
3. Add optional **DAW / Plugin Chain Context** drawer (user-entered DAW, bus routing, or plugin notes—tagged strictly as `user_reported_context`, never treated as measured DSP evidence).
4. Implement **Before/After Mix Revision Comparison**:
   - Upload *Revised Mix (v2)* within the active session.
   - Compute exact deltas ($\Delta\text{LUFS}$, $\Delta\text{dBTP}$, $\Delta\text{LRA}$, $\Delta\text{Band Energy}$) and classify previous findings as **Improved**, **Unchanged**, or **Regressed** with animated `tabular-nums` delta badges and A/B `v1` vs. `v2` auditioning.
5. **Hard Guardrail:** When `has_user_stems === false`, keep stem matrices locked with an honest explanation—never synthesize or infer individual instruments from a stereo mix.

**Completion Gate:**
- [ ] Aligned user stems produce traceable pairwise overlap metrics; misaligned stems return clear validation errors.
- [ ] Stereo-only sessions cannot access or fabricate stem data.
- [ ] Uploading a revised mix displays accurate metric deltas and lets the user A/B `v1` vs. `v2`.

---

### Phase 5 — AI Mentor, Artist Vision & Granular Consent (Hours 32–41)

**Model & Skills:** `Gemini 4 Hydrogen (xhigh)` + **Google AI Studio** + `frontend-design` + `emil-design-eng`.

**Engineering, UI & Motion Tasks:**
1. Prototype and validate Gemini structured-output prompts in **Google AI Studio** so the model strictly cites `evidence_id` tags from the DSP report and refuses to invent plugins, timestamps, or unmeasured instruments.
2. Implement **Artist Vision Profiles** (*Punchy*, *Warm*, *Aggressive*, *Wide*, *Dynamic*):
   - Vision tags guide how the AI Mentor frames trade-offs (e.g., acknowledging intentional saturation in an *Aggressive* mix while still flagging $\text{dBTP} > -0.1$ inter-sample clipping).
3. Implement **Three-Tier Granular Privacy & Consent Controls**:
   - **Toggle A — Metrics-Only AI Mentor (Default Off / Opt-In):** Sends sanitized numerical `AnalysisReport` JSON only—zero audio bytes leave the server.
   - **Toggle B — Direct Audio Listening Analysis (Separate Explicit Opt-In):** Required before sending a compressed audio snippet to the Gemini multimodal endpoint.
   - **Toggle C — Dataset Retention / Future Training (Separate Opt-In, Default Off):** Distinct from Toggle A/B; privacy UI explicitly distinguishes *no training* from *ephemeral provider processing*.
4. Build a **Deterministic Offline Mentor Fallback** so helpful, stage-aware coaching renders even if the Gemini API key is absent or network quota is exhausted during judging.

**Completion Gate:**
- [ ] Network inspection confirms zero audio bytes transmit to Gemini unless Toggle B is explicitly enabled.
- [ ] Every AI Mentor bullet cites real `evidence_id` values from the DSP engine.
- [ ] Deterministic fallback works seamlessly when external AI is toggled off.

---

### Phase 6 — Validation, Deployment & Pitch Deck (Hours 41–48)

**Model & Skills:** `Gemini 4 Hydrogen (high / medium)` + `impeccable` + `ui-ux-pro-max` (`slides`, `banner-design`).

**Engineering, UI & Motion Tasks:**
1. Run full edge-case test suite: digital silence, pure mono files, phase-inverted stereo, heavily clipped masters ($+1.5\text{ dBTP}$), $96\text{ kHz}$ audio, $3\text{-second}$ clips, corrupt headers, and misaligned stems.
2. Execute end-to-end `Playwright` journey covering Simple Mode $\rightarrow$ Advanced Mode $\rightarrow$ Device Lab $\rightarrow$ Revision Upload $\rightarrow$ Privacy Controls.
3. Deploy frontend (Vercel) and Python DSP backend (Railway / Render / Cloud Run), verifying direct CORS uploads and environment variables in a clean incognito browser.
4. Run final `impeccable` UI/motion pass across desktop and mobile viewports.
5. Use `slides` and `banner-design` skills to assemble the 10-section AARAMBHATHON 2.0 presentation deck with real screenshots and record a 3-minute backup demo video.

**Completion Gate:**
- [ ] Public URL works reliably outside local machines.
- [ ] All automated `pytest`, `Vitest`, and `Playwright` checks pass.
- [ ] GitHub `main` branch matches the live deployed build.

---

## 7. Repository Structure & GitHub Workflow

```text
aarambhathon-sikandar-k-chukandar-project/
├── .agents/skills/                  # Generated via `uipro init --ai antigravity`
├── .github/workflows/ci.yml         # Ruff + pytest + ESLint + tsc + Vitest
├── MASTER.md                        # Workspace design & motion governance (from uipro)
├── Audio_Mix_Analyzer_Revised_Master_Plan.md
├── frontend/
│   ├── src/
│   │   ├── app/                     # Next.js App Router (Simple & Advanced routes)
│   │   ├── audio/                   # Web Audio Engine, 15ms ramps, Device Lab filters
│   │   ├── components/
│   │   │   ├── ui/                  # shadcn/ui + HeroUI daylight squircle primitives
│   │   │   ├── simple/              # Beginner 3-card prioritized coaching flow
│   │   │   ├── advanced/            # 60fps Canvas waveform, spectrum, A/B deck, stems
│   │   │   └── privacy/             # 3-tier granular consent controls & audit drawer
│   │   ├── lib/
│   │   │   ├── motion.ts            # STUDIO_SPRING (380/30), STUDIO_EASE, TACTILE_TAP
│   │   │   └── api.ts               # Direct-to-FastAPI upload client
│   │   └── types/report.ts          # Canonical AnalysisReport v1.0 TypeScript contract
│   └── tests/e2e/                   # Playwright end-to-end user journeys
└── backend/
    ├── app/
    │   ├── main.py                  # FastAPI app, CORS, ephemeral session cleanup
    │   ├── api/v1/                  # /analyze, /stems, /compare, /mentor, /health
    │   ├── dsp/                     # loudness.py, peaks.py, dynamics.py, spectrum.py, stereo.py, stems.py
    │   ├── rules/                   # Genre & stage deterministic recommendation engine
    │   ├── ai/                      # Gemini structured-output mentor + deterministic fallback
    │   └── schemas/report.py        # Canonical AnalysisReport v1.0 Pydantic v2 contract
    └── tests/                       # Synthetic signal DSP tests & schema contract tests
```

### Branching & Commit Discipline

- `main`: Protected, demo-ready release branch.
- `dev`: Integration branch; all feature branches (`feat/design-system`, `feat/dsp-core`, `feat/workbench-audio`, `feat/stems-revisions`, `feat/ai-consent`) merge via tested PRs.
- Never commit `.env` files, API keys, or copyrighted commercial music tracks.

---

## 8. Pre-Phase-1 Environment & Workspace Checklist

- [ ] **Git & GitHub:** Confirm write/push access to `https://github.com/nilabhhu/aarambhathon-sikandar-k-chukandar-project` and create `dev` branch.
- [ ] **Antigravity Session Refresh:** Run `/skills reload` in Antigravity so `impeccable`, `ui-ux-pro-max`, `frontend-design`, and `emil-design-eng` are active in the workspace session.
- [ ] **Workspace Skill Init:** Run `uipro init --ai antigravity` inside the cloned repository root to generate `.agents/skills/` and `MASTER.md`.
- [ ] **Runtimes & FFmpeg:** Verify Node.js LTS (`20+`), Python `3.12+`, and `ffmpeg` / `ffprobe` on system `PATH`.
- [ ] **Audio Test Suite:** Prepare royalty-free/original test assets: (1) unmastered mix with intentional low-end buildup and $-0.2\text{ dBTP}$ peak, (2) improved `v2` mix, (3) loudness-matched reference track, and (4) `4` aligned original stems (`Kick`, `Bass`, `Synth`, `Drums`).

---

## 9. Hackathon Presentation & Live Demo Sequence (`slides` Skill)

Use the `ui-ux-pro-max` **`slides`** sub-skill in Phase 6 to structure the 10-slide AARAMBHATHON 2.0 presentation:

1. **Problem Statement:** Bedroom producers struggle to judge loudness, tonal balance, and phone/laptop translation without objective feedback.
2. **Introduction:** Privacy-first AI-assisted mix & mastering workbench with **Simple** and **Advanced** modes.
3. **Objectives:** Real ITU-R BS.1770 / $4\times\text{ dBTP}$ DSP accuracy, learn-by-doing pedagogy, and zero unconsented audio sharing.
4. **Key Features:** Genre/stage context, 60fps interactive markers, click-free A/B reference matching, Device Translation Lab, user-stem overlap, revision deltas.
5. **Project Use Case:** Creator uploads flawed mix $\rightarrow$ hears issue on Laptop preview $\rightarrow$ fixes in DAW $\rightarrow$ verifies `v2` delta.
6. **Methodology:** Hybrid browser Web Audio engine + stateless Python `SciPy`/`pyloudnorm` DSP + evidence-cited Gemini mentor.
7. **Project Timeline:** Six-phase 48-hour execution roadmap (Section 6).
8. **Expected Result:** Repeatable, deterministic mix diagnostics that build real engineering intuition.
9. **Impact:** Democratizes studio-grade acoustic telemetry while protecting unreleased artist IP.
10. **Data & Resources:** ITU-R BS.1770-5 standards, synthetic test signals, open-source Python DSP, and original stems.

---

*End of Revised Master Plan.*