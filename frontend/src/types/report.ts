export type GenreType =
  | "electronic"
  | "pop"
  | "hip_hop"
  | "rock"
  | "acoustic"
  | "ambient"
  | "other";

export type StageType = "unmastered_mix" | "final_master";

export type ArtistVisionTag = "punchy" | "warm" | "aggressive" | "wide" | "dynamic";

export type SeverityType = "safe" | "caution" | "alert";

export type ConfidenceType = "measured" | "estimated" | "heuristic";

export type BandName = "sub" | "low" | "low_mid" | "high_mid" | "presence" | "air";

export type FindingCategory =
  | "loudness"
  | "true_peak"
  | "dynamics"
  | "tonal_balance"
  | "stereo_phase"
  | "stems_overlap"
  | "technical_validation";

export interface UserReportedContext {
  daw: string;
  bus_routing: string;
  plugin_notes: string;
  source_tag: "user_reported_context";
}

export interface AnalysisContext {
  genre: GenreType;
  stage: StageType;
  artist_vision: ArtistVisionTag[];
  has_user_stems: boolean;
  stem_count: number;
  user_reported_context?: UserReportedContext | null;
}

export interface AudioMetadata {
  filename: string;
  duration_sec: number;
  sample_rate_hz: number;
  channels: number;
  bit_depth: number;
  playback_proxy_url: string;
  waveform_peaks: number[][];
  clipping_timestamps_sec: number[];
}

export interface GlobalMetrics {
  integrated_lufs: number;
  short_term_max_lufs: number;
  momentary_max_lufs: number;
  loudness_range_lu: number;
  sample_peak_dbfs: number;
  true_peak_dbtp: number;
  crest_factor_db: number;
  plr_db?: number;
  psr_db: number;
  phase_correlation_avg: number;
  stereo_width_ratio: number;
}

export interface StreamingEstimate {
  platform: string;
  estimated_gain_db: number;
  limiter_engaged_warning: boolean;
  assumption_note: string;
}

export interface SpectralBand {
  band: BandName;
  range_hz: string;
  energy_db: number;
  delta_vs_genre_median_db: number;
  genre_target_low_db?: number | null;
  genre_target_high_db?: number | null;
}

export interface TimeSeries {
  step_sec: number;
  short_term_lufs: number[];
  phase_correlation: number[];
}

export interface Finding {
  evidence_id: string;
  category: FindingCategory;
  severity: SeverityType;
  confidence: ConfidenceType;
  title: string;
  timestamp_start_sec: number;
  timestamp_end_sec: number;
  measured_value: string;
  what_happened: string;
  why_it_matters: string;
  listen_prompt: string;
  what_to_try: string;
  recheck_target: string;
}

export interface StemMetric {
  stem_id: string;
  name: string;
  filename: string;
  duration_sec: number;
  sample_rate_hz: number;
  channels: number;
  integrated_lufs: number;
  sample_peak_dbfs: number;
  true_peak_dbtp: number;
  headroom_db: number;
  phase_correlation_avg?: number;
  spectral_centroid_hz: number;
  band_energies_db: Record<string, number>;
}

export interface StemOverlapPair {
  evidence_id: string;
  stem_a: string;
  stem_b: string;
  band: BandName;
  range_hz: string;
  overlap_score: number;
  combined_excess_db: number;
  phase_interaction_corr?: number | null;
  phase_cancellation_risk?: boolean;
  severity: SeverityType;
  note: string;
}

export interface StemSumResidual {
  rms_diff_db: number;
  peak_diff_db: number;
  correlation_with_mix: number;
  note: string;
}

export interface StemAnalysis {
  alignment_passed: boolean;
  max_duration_delta_ms: number;
  alignment_warnings: string[];
  stems: StemMetric[];
  overlap_matrix: StemOverlapPair[];
  stem_sum_residual: StemSumResidual | null;
}

export interface RevisionMetricDeltas {
  integrated_lufs_delta: number;
  true_peak_dbtp_delta: number;
  loudness_range_lu_delta: number;
  crest_factor_db_delta: number;
  plr_db_delta?: number;
  psr_db_delta: number;
  phase_correlation_delta: number;
  band_deltas_db: Record<string, number>;
}

export interface RevisionFindingStatus {
  evidence_id: string;
  title: string;
  category: FindingCategory;
  status: "improved" | "unchanged" | "regressed";
  baseline_value: string;
  revised_value: string;
  summary: string;
}

export interface RevisionComparison {
  baseline_report_id: string;
  revised_report_id: string;
  baseline_filename: string;
  revised_filename: string;
  revised_playback_proxy_url: string;
  metric_deltas: RevisionMetricDeltas;
  finding_statuses: RevisionFindingStatus[];
}

export interface PrivacyAudit {
  raw_audio_sent_to_ai: boolean;
  external_ai_enabled: boolean;
  training_opt_in: boolean;
  retention_policy: string;
}

export interface AnalysisReport {
  schema_version: "1.0.0";
  session_id: string;
  report_id: string;
  created_at: string;
  context: AnalysisContext;
  audio_metadata: AudioMetadata;
  global_metrics: GlobalMetrics;
  streaming_estimates: StreamingEstimate[];
  spectral_bands: SpectralBand[];
  time_series: TimeSeries;
  findings: Finding[];
  stem_analysis: StemAnalysis | null;
  revision_comparison: RevisionComparison | null;
  privacy_audit: PrivacyAudit;
}

export interface ReferenceTrackMeta {
  reference_filename: string;
  integrated_lufs: number;
  true_peak_dbtp: number;
  duration_sec: number;
  playback_proxy_url: string;
  waveform_peaks: number[][];
  global_metrics?: GlobalMetrics;
  spectral_bands?: SpectralBand[];
}

export interface BackendHealth {
  status: string;
  version?: string;
  ffmpeg_available: boolean;
  gemini_configured: boolean;
  gemini_model?: string;
}

export interface MentorAction {
  evidence_id: string;
  priority: number;
  headline: string;
  coaching_note: string;
  daw_experiment: string;
  verification_step: string;
}

export interface MentorRequest {
  allow_metrics_ai: boolean;
  allow_audio_ai: boolean;
  allow_training_opt_in: boolean;
  question: string;
}

export interface MentorResponse {
  mode: "deterministic_fallback" | "gemini_metrics_only" | "gemini_multimodal_audio";
  model_used: string;
  summary: string;
  vision_alignment_note: string;
  prioritized_actions: MentorAction[];
  cited_evidence_ids: string[];
  privacy_audit: PrivacyAudit;
}
