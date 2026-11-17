# DESIGN.md — MixBench Built Design System

## 1. Visual World & Aesthetic Direction
MixBench adopts a **Daylight-First Acoustic Telemetry Studio** aesthetic: calm studio-paper surfaces (`#FAFAFA`, `#F5F5F7`, `#FFFFFF`), crisp `1px` tinted hairlines (`rgba(24, 34, 32, 0.08)`), muted studio slate-teal primary accent (`#3A7269`), and high-contrast ink (`#182220`). All numeric audio telemetry uses `Geist Mono` with `font-variant-numeric: tabular-nums` to eliminate layout jitter during 60fps canvas playback.

## 2. Color Tokens
| Token | Hex / Value | Role |
|---|---|---|
| `--bg-canvas` | `#FAFAFA` | Viewport canvas |
| `--bg-surface` | `#F5F5F7` | Recessed control wells, sidebars, tabs |
| `--bg-elevated` | `#FFFFFF` | Diagnostic cards, waveform stage, dialogs |
| `--border-hairline` | `rgba(24, 34, 32, 0.08)` | Primary card/well boundaries |
| `--border-active` | `rgba(58, 114, 105, 0.35)` | Active dropzone, selected finding, focus states |
| `--text-primary` | `#182220` | Headings, metric figures, guidance body |
| `--text-secondary` | `#52605D` | Axis labels, timestamps, metadata |
| `--accent-primary` | `#3A7269` | Active actions, playhead dot, segmented `layoutId` pills |
| `--accent-soft` | `#EBF3F1` | Soft chip fills, text selection highlight |
| `--status-safe` | `#15803D` | Within headroom/genre balance targets |
| `--status-caution` | `#B45309` | Translation risk or reference divergence |
| `--status-alert` | `#BE123C` | Inter-sample clipping (`> -0.1 dBTP`) or negative correlation |

## 3. Typography & Radii
- **Headings:** `Plus Jakarta Sans` (`600`, `700`, `-0.02em` letter-spacing)
- **Body:** `Geist` (`400`, `500`, `600`, `1.55` line-height)
- **Telemetry:** `Geist Mono` (`tabular-nums`)
- **Geometry:** `.squircle-outer` (`20px` + `corner-shape: squircle`), `.squircle-inner` (`12px` + `corner-shape: squircle`).

## 4. Motion Choreography
- Root `<MotionConfig reducedMotion="user">`
- `STUDIO_SPRING`: `stiffness: 380, damping: 30, mass: 0.8`
- `TACTILE_TAP`: `scale: 0.97` (`80ms`)
- 60fps Canvas waveform playhead mutates DOM `translate3d` via `requestAnimationFrame` without React `setState` re-renders.
