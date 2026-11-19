# MixBench Studio — Master Design System Specification (v2.0)

> **Aesthetic Direction:** Precision Anodized Audio Hardware meets Editorial Mastering Studio  
> **Reference Craft:** Teenage Engineering hardware discipline · Technics direct-drive tactile geometry · Linear/MotionSites typographic restraint  
> **Target Score:** 100 / 100 Commercial Audio-Engineering Web Application

---

## 1. Anti-Slop Prohibitions (Hard Constraints)

Every surface, component, and motion curve MUST pass this audit:

1. **Zero neon glow borders** — No cyan, emerald, or purple outer glow rings (`box-shadow: 0 0 20px ...`) around cards, containers, or marketing blocks.
2. **Zero generic purple/blue gradients** — No AI-template indigo-violet washes, mesh blobs, or glassmorphism over purple gradients.
3. **Zero default template fonts** — Never fall back to `Inter`, `Roboto`, or unstyled system sans.
4. **Zero monospace marketing copy** — `JetBrains Mono` is strictly reserved for live numerical audio telemetry (`LUFS`, `dBTP`, `Hz`, `BPM`, `dB`, `LU`, timecodes, `evidence_id`). Never use monospace for marketing headlines, eyebrows, or body copy.
5. **Zero filler chrome** — No `"SCROLL TO EXPLORE"`, `"Auto Loop"`, decorative fake terminal bars, or cramped 3-line telemetry boxes inside hero sections.
6. **Zero invisible back-navigation bugs** — Above-the-fold hero typography and CTAs must never sit at `opacity: 0` waiting on an intersection observer that fails after Next.js App Router back-navigation.

---

## 2. Color Architecture (Dual-Theme Hardware Tokens)

### 2.1 Dark Studio Surface (Default — `.dark`)

| Token | Hex / Value | Role |
| --- | --- | --- |
| `--bg-canvas` | `#090B0E` | Deep matte carbon-obsidian page canvas |
| `--bg-surface` | `#0D1015` | Secondary anodized deck surface |
| `--bg-elevated` | `#11141B` | Elevated anodized slate cards & console modules |
| `--bg-elevated-hover` | `#171B24` | Tactile hover surface |
| `--bg-inset` | `#0B0D12` | Recessed meter wells, waveform beds, input wells |
| `--border-hairline` | `rgba(255, 255, 255, 0.08)` | Ultra-fine 1px chassis separation (primary border) |
| `--border-strong` | `rgba(255, 255, 255, 0.16)` | Interactive hover / focus container separation |
| `--border-active` | `rgba(34, 197, 139, 0.42)` | Active selection & focused finding frame |
| `--text-primary` | `#F4F1EA` | Warm studio ivory primary ink (contrast > 16:1 on `#090B0E`) |
| `--text-secondary` | `#9CA3AF` | Muted cool-stone secondary copy (contrast > 6.8:1) |
| `--text-muted` | `#6B7280` | Quiet axis ticks & secondary timestamps (contrast > 4.5:1 on elevated) |

### 2.2 Warm Daylight Studio Light Mode Toggle (`:root`)

| Token | Hex / Value | Role |
| --- | --- | --- |
| `--bg-canvas` | `#F6F3EC` | Warm architectural paper canvas |
| `--bg-surface` | `#EFEAE0` | Drafting deck secondary surface |
| `--bg-elevated` | `#FFFFFF` | Pure matte white elevated cards |
| `--bg-elevated-hover` | `#FAF8F4` | Subtle hover state |
| `--bg-inset` | `#EAE4D7` | Recessed instrument wells |
| `--border-hairline` | `rgba(17, 19, 24, 0.10)` | Crisp architectural hairline |
| `--border-strong` | `rgba(17, 19, 24, 0.18)` | Active hover hairline |
| `--text-primary` | `#111318` | Crisp carbon primary ink (contrast > 16:1) |
| `--text-secondary` | `#4B5260` | Neutral graphite secondary ink |
| `--text-muted` | `#666E7E` | Axis legends & tertiary metadata |

### 2.3 Purposeful Hardware Signal Accents (Used Sparingly for Acoustic Meaning)

| Signal Token | Dark Value | Light Value | Acoustic Meaning |
| --- | --- | --- | --- |
| `--studio-vermilion` | `#E5483A` | `#D1382B` | Clipping overs (`> 0.0 dBTP`), objective defects, active flaw pins |
| `--studio-amber` | `#E89B2D` | `#B8730B` | Analog VU warmth, headroom caution, tonal congestion warnings |
| `--studio-mint` | `#22C58B` | `#0F8F64` | Locked stereo phase, verified v1→v2 improvements, live DSP online LED |
| `--studio-cobalt` | `#3B82F6` | `#2057D6` | Stereo field / reference overlay & stylistic choice classification |

---

## 3. Typography & Optical Scale

| Role | Family | Weights | Tracking | Line Height | Usage |
| --- | --- | --- | --- | --- | --- |
| Landing Display | `Instrument Serif` | `400` | `-0.025em` | `1.04` | Full-bleed hero headline (`clamp(2.85rem, 6.2vw, 5.25rem)`), editorial section titles (`clamp(2rem, 4vw, 3.25rem)`) |
| Studio Heading | `Plus Jakarta Sans` | `600`, `700` | `-0.02em` | `1.18` | Brand wordmark, studio headers, module titles (`16px–24px`) |
| Body Copy | `Plus Jakarta Sans` | `400`, `500`, `600` | `-0.005em` | `1.65` (landing) / `1.5` (workbench) | Editorial copy (`16px–18px` landing, max-width `62ch`), workbench labels (`12px–14px`) |
| Audio Telemetry | `JetBrains Mono` | `400`, `500`, `600` | `0em` | `1.2` | **Strictly** live figures (`-14.0 LUFS`, `-1.76 dBTP`, `124 BPM`, `0:03`, `ev_*`) with `font-variant-numeric: tabular-nums` |

---

## 4. Geometry, Elevation & Layout Rhythm

- **Corner Radii:**
  - Outer cards & hardware modules: `20px` (`.squircle-outer`, applying `corner-shape: squircle;` inside `@supports`)
  - Hero media frames: `24px`
  - Inputs, buttons, pills, recessed meters: `10px–12px` (`.squircle-inner`, applying `corner-shape: squircle;` inside `@supports`)
- **Borders over Shadows:** Separate surfaces with `1px solid var(--border-hairline)`. Reserve subtle dark elevation shadow exclusively for floating popovers, modals, and drawers.
- **Container Widths:**
  - Landing Page Editorial Grid: `max-w-[1280px]`, section vertical spacing `py-20` to `py-28` (`80px–112px`), horizontal padding `px-5 sm:px-8 lg:px-10`.
  - Production Workbench (`/studio`): `max-w-[1380px]`, single-row desktop header strictly `h-16` (`64px`) at `>= 1024px`.
- **Single-Line Metric Readout Rule:** Never wrap metric value + unit onto 3 lines. Always enforce `whitespace-nowrap tabular-telemetry` with generous column width (`min-w-0`) and clean label/value separation.

---

## 5. Motion Choreography & Physics

| Category | Engine | Parameters | Rules |
| --- | --- | --- | --- |
| Interactive UI (tabs, drawers, modals, dropdowns, tonearm) | `motion/react` | `type: "spring", stiffness: 380, damping: 30, mass: 0.85` | Interruptible, zero bouncy overshoot |
| Micro-interactions (hover, press, focus) | `motion/react` / CSS | `cubic-bezier(0.22, 1, 0.36, 1)`, `150ms–240ms`, `whileTap={{ scale: 0.98 }}` | GPU properties only (`transform`, `opacity`, `clip-path`) |
| Scroll Smoothness (`/`) | `lenis` + `gsap/ScrollTrigger` | `duration: 1.05`, `wheelMultiplier: 0.9` | Full cleanup (`ScrollTrigger.getAll().forEach(t => t.kill())`) on unmount/route change |
| Hero Mount Reveal (`/`) | `motion/react` | Animate on mount with `initial={false}` or guaranteed settle (`opacity: 1`) | **Never** gate hero visibility on `whileInView` or ScrollTrigger — guarantees `opacity === 1` after back-navigation |
| Below-the-fold Reveals | `motion/react` | `viewport={{ once: true, amount: 0.2 }}` with `opacity` + `translateY(14px)` | Strictly honors `prefers-reduced-motion` |
| Off-screen Media / Canvas Pause | `IntersectionObserver` | Pause Veo `<video>` and 60 fps canvas loops when off-screen | Zero idle GPU/CPU drain |

---

## 6. Route Split & Navigation Architecture

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | Public (also accessible when signed in with `Enter Studio` CTA) | 5-section HD-motion editorial Landing Page + live interactive Demo Vinyl / Spectrum / Flaw Timeline preview |
| `/studio` | Strictly Auth-Gated (`middleware.ts` + client Supabase session guard → redirects to `/?signin=1`) | Full MixBench Production Workbench (Upload Stage, Simple/Advanced Mix Check, Reference A/B, Stems, v1→v2 Revisions, AI Mix Mentor Drawer, Saved Mix History, Bottom Transport Dock) |
| `/auth/callback` | Public OAuth handler | Exchanges PKCE code for Supabase session and redirects directly into `/studio` |
| `/privacy`, `/terms`, `/status`, `/share/[token]` | Public | Legal policies, live DSP contract diagnostics, and read-only shared client reports |

---

## 7. Bespoke Media Assets Inventory (`frontend/public/media/`)

| Asset | File(s) | Target Budget | Placement |
| --- | --- | --- | --- |
| Looping Studio Hero Video | `hero-studio-loop.mp4` (H.264), `hero-studio-loop.webm` (VP9), `hero-studio-poster.webp` | `< 4 MB` muted loop | `/` Section 1 Full-Bleed Cinema Hero backdrop with `>= 85%` contrast editorial scrim |
| Vinyl Platter Macro Texture | `vinyl-platter-macro.webp` | `< 350 KB` 2K WebP | Masked inside `SpinningDiscPlayer.tsx` platter rotating at 33.3 RPM |
| Studio Mastering Console Macro | `studio-console-macro.webp` | `< 450 KB` 2K WebP | `/` Section 3 Editorial 3-Pillar Proof Band split visual |

---

## 8. Bug Remediation Targets (from Commit `9b985fa`)

1. **Back-Navigation Hero `opacity: 0` Bug:** Remove ScrollTrigger/observer gating from hero mount; run deterministic cleanup & `ScrollTrigger.refresh()` on navigation.
2. **Overlapping Flaw-Marker Pills (`FlawTimelineBar.tsx`):** Cluster markers within `< 4%` timeline width into a single pill (`N Flaws · 0:03`) with interactive hover/click stacked popover list.
3. **Studio Header 2-Row Wrap & Sticky Tab Clipping (`StudioHeader.tsx`, `WorkspaceSubNav.tsx`):** Strictly single-row `h-16` desktop header (`>= 1024px`) by consolidating `EQ Preset`, `JSON`, `PDF`, and `Share` into a sleek `Export / Share` dropdown; ensure `Advanced Mix Check` never clips trailing `k` (`whitespace-nowrap px-3.5`) and align `layoutId` active tab indicator flush inside button bounds.
4. **BottomTransportDock Pill Clipping & Metric Wrapping (`BottomTransportDock.tsx`, `SpinningDiscPlayer.tsx`):** Concise non-clipping hardware labels (`Full`, `Phone`, `Laptop` on compact viewports; full unclipped labels on wide viewports), zero mid-word truncation (`DIRECT-DRIVE · 33.3 RPM`, full subtitle), single-line `tabular-nums` alignment for `LOUDNESS`, `TRUE PEAK`, `TEMPO`.
5. **Large Real-World WAV Verification (`frisby master 9.wav`):** Zero CLS across Spinning Disc, 48-Band Spectrum, Flaw Timeline, and Advanced Telemetry on 28.96 MB 44.1 kHz / 16-bit stereo WAV.
