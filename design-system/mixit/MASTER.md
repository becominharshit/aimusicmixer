# Mixit — Swiss Neo-Brutalist Audio Studio Design System (`MASTER.md`)

## 1. Brand Architecture
- **Product Name:** `Mixit` (Stylized `MIXIT.`)
- **Brand Assets (`frontend/public/brand/`):**
  - `mixit-mark.webp` / `mixit-mark.png` (`256×256` / `512×512`) — Square geometric vinyl + equalizer emblem **without** wordmark; used for favicon (`src/app/icon.png`), compact mobile cells, turntable accents, and square emblem blocks.
  - `mixit-logo-full.webp` / `mixit-logo-full.png` — Full transparent lockup (`#0A0A0A` wordmark + full-color mark) for Swiss Daylight `#FFFFFF` and Signal Yellow `#FFE01B` surfaces.
  - `mixit-logo-full-dark.webp` / `mixit-logo-full-dark.png` — Full transparent lockup (`#F4F1EA` warm ivory wordmark + framed full-color mark) for Matte Obsidian `#0A0C10` surfaces.

## 2. Cohesive Twin Worlds (`/` vs. `/studio`)

### World A — Landing Page (`/`, Swiss Daylight Architecture)
- **Canvas:** `#FFFFFF` (Gallery White)
- **Secondary Cell:** `#F7F7F5` (Architectural Warm Paper)
- **Structural Grid Borders:** `1.5px` / `2px` solid `#0A0A0A` (zero drop shadows, zero soft blur glass, zero purple/blue gradients)
- **Primary Ink:** `#0A0A0A` (contrast `21:1` on `#FFFFFF`)
- **Secondary Ink:** `#3F3F46` (contrast `10.4:1` on `#FFFFFF`)
- **Signal Yellow Accent:** `#FFE01B` — Primary CTAs (`ENTER STUDIO ↗`, `LAUNCH STUDIO ↗`), live engine status cell, bottom geometric emblem block. Always paired with `#0A0A0A` ink (`15.4:1` WCAG AAA).
- **Swiss Vermilion Accent:** `#FF3B1F` — Rotating emblem square, active `02` feature row highlight, footer CTA block (`READY TO CHECK YOUR MIX? ↗`). Paired with `#0A0A0A` bold display ink (`5.55:1` WCAG AA/AAA).
- **Hardware Instrument Inset:** Pure `#0A0A0A` exclusively framing the live turntable, 48-Band Spectral Analyzer, and Interactive Flaw Timeline so colorful real-time telemetry pops with precision.

### World B — Production Workbench (`/studio`, Matte Obsidian Console Default + `PAPER / INK` Toggle)
- **Default Dark Console (`[data-theme="dark"]`):**
  - Canvas: `#0A0C10`
  - Grid Cells / Cards: `#12151C`
  - Hardware Instrument Screen: `#0A0A0A`
  - Grid Borders: `1px solid #262B36` (`1.5px` on major console rails)
  - Primary Ink: `#F4F1EA` (Warm Ivory, `17.9:1` on `#0A0C10`)
  - Secondary Ink: `#9CA3AF` (`7.3:1` on `#0A0C10`)
  - Primary Active State: `#FFE01B` Signal Yellow (`#0A0A0A` ink)
  - Critical Alert / Clipping: `#FF3B1F` Swiss Vermilion
  - Calibrated Pass / Locked Phase / Online: `#22C58B` Acid Mint
- **Optional Light Mode (`PAPER` toggle, `[data-theme="light"]`):**
  - Switches `/studio` seamlessly to crisp `#FFFFFF` canvas, `#F7F7F5` cells, `#0A0A0A` ink, `1.5px solid #0A0A0A` grid borders, keeping hardware instrument screens on `#0A0A0A`.

## 3. Multi-Color Real-Time Audio Instruments (Strictly Concentrated Inside Instruments)
1. **Spinning Vinyl Disc (`SpinningDiscPlayer.tsx`):** Photorealistic `/media/vinyl-platter-macro.webp` at `33.3 RPM`, spring tonearm glide, and bass-reactive `20–120 Hz` radial rim glow driven by `AnalyserNode`.
2. **48-Band Live Spectral Analyzer (`LiveSpectralGraph.tsx`):** 60 fps HiDPI `<canvas>` on `#0A0A0A` with vibrant frequency-zone gradient bars (`#FF3B1F` Sub 20–60 Hz → `#F59E0B` Low/Low-Mid → `#22C58B` Mids → `#38BDF8` Presence/Air), peak-hold caps, clickable frequency zone buttons (`SUB`, `LOW`, `LOW-MID`, `HIGH-MID`, `PRESENCE`, `AIR`), and translucent Genre Target Envelope.
3. **Interactive Flaw-Marker Timeline (`FlawTimelineBar.tsx`) & 5-Step Progress Rail (`DspStepTracker.tsx`):** Clustered `< 4%` + viewport-aware anti-collision flaw pills (`2 FLAWS · 0:03`), BPM section chips, and Swiss 5-step horizontal progress rail with elapsed milliseconds and `aria-live="polite"` announcements.

## 4. Typography Scale
- **Display Condensed (`--font-display`):** `Anton` (`400`) & `Barlow Condensed` (`700`, `800`) — Uppercase headlines, tight tracking (`-0.02em`), tight leading (`0.92` on hero display, `1.0` on `01/02/03` numerals).
- **UI Body (`--font-sans`):** `Plus Jakarta Sans` (`400`–`700`, `antialiased`).
- **Telemetry (`--font-mono`):** `JetBrains Mono` (`tabular-nums`) — Strictly numerical telemetry (LUFS, dBTP, Hz, BPM, timestamps, `evidence_id`).

## 5. Layout, Motion & Accessibility Contracts
- **Strict Copy Minimalism on `/`:** Every headline `<= 6` words; every sub-label `<= 12` words.
- **Desktop Header (`StudioHeader.tsx`):** Strictly single-row `h-16` (`<= 68px`) at `>= 1024px` with consolidated `EXPORT / SHARE` dropdown, unclipped `Advanced Mix Check`, and `PAPER / INK` toggle.
- **Motion Physics:** `motion/react` spring (`stiffness: 380, damping: 30`), `cubic-bezier(0.22, 1, 0.36, 1)`, GPU-composited properties only, Lenis smooth scroll + GSAP ScrollTrigger cleanup on unmount, hero strictly mounted at `opacity: 1` (zero `whileInView` hero gating), `prefers-reduced-motion` honored everywhere.
- **Compliance & Keyboard Access:** Essential-only `/cookies` policy + compact Swiss cookie banner, explicit Sign-Up consent checkbox in `AuthModal.tsx`, zero third-party ad/analytics trackers, visible `:focus-visible` outlines across all interactive controls.
