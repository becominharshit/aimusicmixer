from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

GenreType = Literal[
    "electronic",
    "pop",
    "hip_hop",
    "rock",
    "acoustic",
    "ambient",
    "other",
]
StageType = Literal["unmastered_mix", "final_master"]
ArtistVisionTag = Literal["punchy", "warm", "aggressive", "wide", "dynamic"]
SeverityType = Literal["safe", "caution", "alert"]
ConfidenceType = Literal["measured", "estimated", "heuristic"]
BandName = Literal["sub", "low", "low_mid", "high_mid", "presence", "air"]
FindingCategory = Literal[
    "loudness",
    "true_peak",
    "dynamics",
    "tonal_balance",
    "stereo_phase",
    "stems_overlap",
    "technical_validation",
]
FindingClassification = Literal["objective_defect", "stylistic_choice"]


class UserReportedContext(BaseModel):
    daw: str = ""
    bus_routing: str = ""
    plugin_notes: str = ""
    source_tag: Literal["user_reported_context"] = "user_reported_context"


class AnalysisContext(BaseModel):
    genre: GenreType = "electronic"
    stage: StageType = "unmastered_mix"
    artist_vision: list[ArtistVisionTag] = Field(default_factory=list)
    has_user_stems: bool = False
    stem_count: int = 0
    user_reported_context: UserReportedContext | None = None


class SongSection(BaseModel):
    label: str
    start_sec: float
    end_sec: float
    avg_lufs: float


class AudioMetadata(BaseModel):
    filename: str
    duration_sec: float
    sample_rate_hz: int
    channels: int
    bit_depth: int
    playback_proxy_url: str
    waveform_peaks: list[list[float]] = Field(default_factory=list)
    clipping_timestamps_sec: list[float] = Field(default_factory=list)
    bpm: float | None = None
    sections: list[SongSection] = Field(default_factory=list)


class GlobalMetrics(BaseModel):
    integrated_lufs: float
    short_term_max_lufs: float
    momentary_max_lufs: float
    loudness_range_lu: float
    sample_peak_dbfs: float
    true_peak_dbtp: float
    crest_factor_db: float
    plr_db: float = 0.0
    psr_db: float
    transient_punch_db: float | None = None
    phase_correlation_avg: float
    low_end_phase_correlation: float = 1.0
    stereo_width_ratio: float


class StreamingEstimate(BaseModel):
    platform: str
    estimated_gain_db: float
    limiter_engaged_warning: bool
    assumption_note: str


class SpectralBand(BaseModel):
    band: BandName
    range_hz: str
    energy_db: float
    delta_vs_genre_median_db: float
    genre_target_low_db: float | None = None
    genre_target_high_db: float | None = None


class TimeSeries(BaseModel):
    step_sec: float = 1.0
    short_term_lufs: list[float] = Field(default_factory=list)
    phase_correlation: list[float] = Field(default_factory=list)


class Finding(BaseModel):
    evidence_id: str
    category: FindingCategory
    severity: SeverityType
    classification: FindingClassification = "stylistic_choice"
    confidence: ConfidenceType = "measured"
    band_name: BandName | None = None
    title: str
    timestamp_start_sec: float
    timestamp_end_sec: float
    measured_value: str
    what_happened: str
    why_it_matters: str
    listen_prompt: str
    what_to_try: str
    recheck_target: str


class StemMetric(BaseModel):
    stem_id: str
    name: str
    filename: str
    duration_sec: float
    sample_rate_hz: int
    channels: int
    integrated_lufs: float
    sample_peak_dbfs: float
    true_peak_dbtp: float
    headroom_db: float
    phase_correlation_avg: float = 1.0
    spectral_centroid_hz: float
    band_energies_db: dict[str, float] = Field(default_factory=dict)


class StemOverlapPair(BaseModel):
    evidence_id: str
    stem_a: str
    stem_b: str
    band: BandName
    range_hz: str
    overlap_score: float
    combined_excess_db: float
    phase_interaction_corr: float | None = None
    phase_cancellation_risk: bool = False
    severity: SeverityType
    note: str


class StemSumResidual(BaseModel):
    rms_diff_db: float
    peak_diff_db: float
    correlation_with_mix: float
    note: str


class StemAnalysis(BaseModel):
    alignment_passed: bool
    max_duration_delta_ms: float
    alignment_warnings: list[str] = Field(default_factory=list)
    stems: list[StemMetric] = Field(default_factory=list)
    overlap_matrix: list[StemOverlapPair] = Field(default_factory=list)
    stem_sum_residual: StemSumResidual | None = None


class RevisionMetricDeltas(BaseModel):
    integrated_lufs_delta: float
    true_peak_dbtp_delta: float
    loudness_range_lu_delta: float
    crest_factor_db_delta: float
    plr_db_delta: float = 0.0
    psr_db_delta: float
    phase_correlation_delta: float
    band_deltas_db: dict[str, float] = Field(default_factory=dict)


class RevisionFindingStatus(BaseModel):
    evidence_id: str
    title: str
    category: FindingCategory
    status: Literal["improved", "unchanged", "regressed"]
    baseline_value: str
    revised_value: str
    summary: str


class RevisionComparison(BaseModel):
    baseline_report_id: str
    revised_report_id: str
    baseline_filename: str
    revised_filename: str
    revised_playback_proxy_url: str
    metric_deltas: RevisionMetricDeltas
    finding_statuses: list[RevisionFindingStatus] = Field(default_factory=list)


class PrivacyAudit(BaseModel):
    raw_audio_sent_to_ai: bool = False
    external_ai_enabled: bool = False
    training_opt_in: bool = False
    retention_policy: str = (
        "Ephemeral session storage; deleted automatically after 60 minutes or manual session clear."
    )


class AnalysisReport(BaseModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    session_id: str
    report_id: str
    created_at: str
    context: AnalysisContext
    audio_metadata: AudioMetadata
    global_metrics: GlobalMetrics
    streaming_estimates: list[StreamingEstimate] = Field(default_factory=list)
    spectral_bands: list[SpectralBand] = Field(default_factory=list)
    time_series: TimeSeries
    findings: list[Finding] = Field(default_factory=list)
    stem_analysis: StemAnalysis | None = None
    revision_comparison: RevisionComparison | None = None
    privacy_audit: PrivacyAudit = Field(default_factory=PrivacyAudit)


class MentorAction(BaseModel):
    evidence_id: str
    priority: int
    headline: str
    coaching_note: str
    daw_experiment: str
    verification_step: str


class MentorChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=2000)


class MentorRequest(BaseModel):
    allow_metrics_ai: bool = False
    allow_audio_ai: bool = False
    allow_training_opt_in: bool = False
    question: str = ""
    conversation_history: list[MentorChatTurn] = Field(default_factory=list)


class MentorResponse(BaseModel):
    mode: Literal["deterministic_fallback", "gemini_metrics_only", "gemini_multimodal_audio"]
    model_used: str
    fallback_reason: str | None = None
    summary: str
    vision_alignment_note: str
    prioritized_actions: list[MentorAction] = Field(default_factory=list)
    cited_evidence_ids: list[str] = Field(default_factory=list)
    privacy_audit: PrivacyAudit


class CompareReportsRequest(BaseModel):
    baseline: AnalysisReport
    revised: AnalysisReport | None = None


class CompareDemoFallbackRequest(BaseModel):
    baseline: AnalysisReport | None = None


class ContextUpdateRequest(BaseModel):
    genre: GenreType | None = None
    stage: StageType | None = None
    artist_vision: list[ArtistVisionTag] | None = None
    daw: str | None = None
    bus_routing: str | None = None
    plugin_notes: str | None = None
    source_tag: Literal["user_reported_context"] = "user_reported_context"


class MentorStandaloneRequest(MentorRequest):
    session_id: str | None = None
    report: AnalysisReport | None = None
