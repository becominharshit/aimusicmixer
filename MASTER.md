# MASTER.md — MixBench Design, Telemetry & Motion Governance

Generated from workspace design audit + `ui-ux-pro-max` + `GEMINI.md` global rules.
**Note:** Daylight-first rules in the project brief and global `GEMINI.md` intentionally override dark-theme audio defaults.

## 1. Visual Tokens (Daylight-First Acoustic Studio)
| Token | Value | Usage |
|---|---|---|
| `--bg-canvas` | `#FAFAFA` | Primary application viewport background |
| `--bg-surface` | `#F5F5F7` | Recessed control wells, timeline tracks, inspector sidebars, table headers |
| `--bg-elevated` | `#FFFFFF` | Diagnostic cards, active waveform stage, modal sheets |
| `--border-hairline` | `rgba(24, 34, 32, 0.08)` | Subtle `1px` tinted border separating surfaces |
| `--border-active` | `rgba(58, 114, 105, 0.35)` | Focused controls, active A/B deck, selected issue marker |
| `--text-primary` | `#182220` | Primary headings, metric readouts, actionable steps |
| `--text-secondary` | `#52605D` | Explanatory context, timestamps, axis labels |
| `--accent-primary` | `#3A7269` | Primary interactive actions, active playhead, selected `layoutId` pill |
| `--accent-soft` | `#EBF3F1` | Tinted badge fills, active row background, hover surfaces |
| `--status-safe` | `#15803D` | Within genre/stage dynamic & headroom expectations |
| `--status-caution` | `#B45309` | Potential translation concern or reference divergence |
| `--status-alert` | `#BE123C` | Inter-sample clipping (`> -0.1 dBTP`), negative phase correlation, file error |

## 2. Typography & Tabular Numerals
- **Display & Headings:** `Plus Jakarta Sans` (weights `600`, `700`, tracking `-0.02em`)
- **UI Body & Coaching:** `Geist` (`--font-geist-sans`, fallback `DM Sans`) (weights `400`, `500`, `600`, line-height `1.55`)
- **Telemetry & Timestamps:** `Geist Mono` (`--font-geist-mono`) with `font-variant-numeric: tabular-nums` enforced on all LUFS, dBTP, Hz, LRA, correlation, and `MM:SS.t` readouts.

## 3. Squircle Geometry & Surface Craft
- Outer containers, dropzones, workbench stages, and modal dialogs: `border-radius: 20px;` + `corner-shape: squircle;`
- Inner cards, segmented pills, buttons, and status badges: `border-radius: 12px;` + `corner-shape: squircle;`
- Elevation declared once via `1px` hairline borders (`--border-hairline`), avoiding heavy SaaS drop shadows or neon dark gradients.
- Browser chrome (text selection, focus-visible ring, scrollbars) explicitly styled from the daylight palette.

## 4. Motion Choreography (`motion/react`)
- Root `<MotionConfig reducedMotion="user">` wraps the entire app.
- `STUDIO_SPRING`: `{ type: "spring", stiffness: 380, damping: 30, mass: 0.8 }` for `layoutId` pills, drawers, and mode switchers.
- `STUDIO_EASE`: `[0.22, 1, 0.36, 1]` (`150ms–280ms`) for enter/reveal transitions.
- `TACTILE_TAP`: `{ scale: 0.97, transition: { duration: 0.08, ease: [0.22, 1, 0.36, 1] } }`.
- **Zero 60Hz React Re-Render Rule:** Waveform playhead, meters, and loop scrubbers animate on HTML5 `<canvas>` / `transform: translate3d(...)` via `requestAnimationFrame` reading `AudioContext.currentTime`, never React `useState`.
- **Audio-Visual Synchronization:** Every `Mix A` / `Reference B`, `Stereo` / `Mono`, and Device Lab toggle aligns a `layoutId` spring transition with a `15ms` exponential `GainNode` ramp (`setTargetAtTime`).

## 5. Anti-Slop Prohibitions
- Never display arbitrary aggregate scores (e.g., "Mix Score: 84/100").
- Never render dark neon waveforms.
- Never use emojis as UI icons; use `lucide-react` consistently.
- Never suppress objective clipping or phase warnings when creative profile tags are active.
