# Product Specification — MixBench (Privacy-First Music Mix & Mastering Learning Platform)

## Product Truth
- **Name:** MixBench
- **Motto:** Learn mixing and mastering by doing mixing and mastering, with meaningful insights from AI.
- **Category:** Privacy-first acoustic telemetry and DAW mix-learning workbench.
- **Not:** An automated one-click AI mastering replacement, nor an AI stem-separation black box.

## Core User Modes
1. **Simple Mix Check:** Beginner-friendly, genre- and stage-contextualized coaching displaying the top 3 prioritized findings in a 5-step pedagogy (*What happened → Why it matters → Listen → What to try → Recheck*) with direct timestamp auditioning.
2. **Advanced Mix Check:** Full acoustic workbench featuring a 60fps Canvas waveform with clickable issue pins, integrated-LUFS loudness-matched A/B reference switching, calibrated Web Audio Device Translation Lab (*Full Range*, *Smartphone*, *Laptop*, *Mono Fold*), 6-band tonal profile vs. genre median, short-term LUFS & stereo phase timelines, user-supplied stem overlap matrix, revision `v1` vs. `v2` delta comparison, DAW context notes, and opt-in Gemini Mentor.

## Non-Negotiable Guardrails
- **Zero AI Stem Separation:** Stem diagnostics operate exclusively on user-uploaded stems; stereo mixdowns never fabricate instrument-specific diagnostics.
- **Evidence Bound:** Every diagnostic finding traces to deterministic DSP measurements via a unique `evidence_id`.
- **No Fake Scores:** Never compute or display arbitrary aggregate "quality scores" (e.g., 84/100).
- **Granular Consent:** Toggle A (Metrics-Only AI), Toggle B (Multimodal Audio Opt-In), and Toggle C (Training Opt-In) are independent controls; all default off.
- **Honest Approximations:** Device Translation Lab profiles are explicitly labeled as educational `BiquadFilterNode` approximations.
