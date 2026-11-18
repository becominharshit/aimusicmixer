import { NextResponse } from "next/server";
import type { AnalysisReport } from "@/types/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report: AnalysisReport = {
    schema_version: "1.0.0",
    session_id: "sess_mock_01",
    report_id: "rep_9f8a7b6c",
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    context: {
      genre: "electronic",
      stage: "unmastered_mix",
      artist_vision: ["punchy", "wide"],
      has_user_stems: false,
      stem_count: 0,
    },
    audio_metadata: {
      filename: "track_v1.wav",
      duration_sec: 194.5,
      sample_rate_hz: 48000,
      channels: 2,
      bit_depth: 24,
      playback_proxy_url: "/api/v1/sessions/sess_mock_01/proxy/proxy.m4a",
      waveform_peaks: [
        [-0.4, 0.42],
        [-0.62, 0.58],
        [-0.71, 0.74],
        [-0.55, 0.51],
      ],
      clipping_timestamps_sec: [],
    },
    global_metrics: {
      integrated_lufs: -16.4,
      short_term_max_lufs: -12.1,
      momentary_max_lufs: -10.3,
      loudness_range_lu: 6.8,
      sample_peak_dbfs: -1.8,
      true_peak_dbtp: -1.5,
      crest_factor_db: 14.6,
      plr_db: 13.1,
      psr_db: 11.2,
      phase_correlation_avg: 0.78,
      low_end_phase_correlation: 0.96,
      stereo_width_ratio: 0.42,
    },
    streaming_estimates: [
      {
        platform: "Spotify (Normal -14 LUFS)",
        estimated_gain_db: 2.4,
        limiter_engaged_warning: true,
        assumption_note:
          "Assumes Normal loudness mode (-14 LUFS target). Positive gain (+2.4 dB) would push true peak above -1.0 dBTP; client limiter may reduce peaks.",
      },
    ],
    spectral_bands: [
      { band: "sub", range_hz: "20-60", energy_db: -22.1, delta_vs_genre_median_db: 1.2 },
      { band: "low", range_hz: "60-250", energy_db: -18.4, delta_vs_genre_median_db: 3.4 },
      { band: "low_mid", range_hz: "250-800", energy_db: -21.0, delta_vs_genre_median_db: 0.5 },
      { band: "high_mid", range_hz: "800-4000", energy_db: -23.5, delta_vs_genre_median_db: -1.1 },
      { band: "presence", range_hz: "4000-10000", energy_db: -26.8, delta_vs_genre_median_db: -0.8 },
      { band: "air", range_hz: "10000-20000", energy_db: -34.2, delta_vs_genre_median_db: -1.5 },
    ],
    time_series: {
      step_sec: 1.0,
      short_term_lufs: [-24.1, -18.2, -14.5],
      phase_correlation: [0.92, 0.81, 0.45],
    },
    findings: [
      {
        evidence_id: "ev_low_buildup_01",
        category: "tonal_balance",
        severity: "caution",
        confidence: "measured",
        band_name: "low",
        title: "Low-End Buildup Around 60–250 Hz",
        timestamp_start_sec: 64.0,
        timestamp_end_sec: 82.0,
        measured_value: "+3.4 dB above genre reference range",
        what_happened:
          "Energy between 60 Hz and 250 Hz rises +3.4 dB above typical electronic unmastered mixes during the main drop.",
        why_it_matters:
          "Excess low-end energy consumes headroom early and can sound muddy or boomy on laptop and phone speakers.",
        listen_prompt:
          "Jump to 01:04 and toggle the Laptop and Smartphone translation previews to hear if the kick and bass blur together.",
        what_to_try:
          "Check high-pass filters on non-bass instruments around 100–140 Hz or apply a gentle 1.5–2.5 dB dynamic EQ dip near 140 Hz.",
        recheck_target:
          "Re-export and verify 60–250 Hz band energy moves closer to 0 to +1.5 dB relative balance.",
      },
    ],
    stem_analysis: null,
    revision_comparison: null,
    privacy_audit: {
      raw_audio_sent_to_ai: false,
      external_ai_enabled: false,
      training_opt_in: false,
      retention_policy: "Zero raw audio transmitted to external AI by default.",
    },
  };
  return NextResponse.json(report);
}
