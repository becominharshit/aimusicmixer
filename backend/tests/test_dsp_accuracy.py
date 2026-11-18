from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.dsp import (
    AudioIngestionError,
    analyze_user_stems,
    compute_loudness_metrics,
    compute_peak_metrics,
    compute_spectral_profile,
    compute_stereo_metrics,
    load_audio_file,
)
from app.rules import evaluate_mix_findings
from app.schemas.report import AnalysisContext


def test_lufs_accuracy_on_1khz_sine() -> None:
    sr = 48000
    t = np.arange(sr * 5) / sr
    # 1 kHz stereo sine at -14 dBFS RMS -> amplitude = sqrt(2) * 10**(-14/20)
    target_rms = 10 ** (-14.0 / 20.0)
    amp = target_rms * np.sqrt(2.0)
    sine = amp * np.sin(2.0 * np.pi * 1000.0 * t)
    stereo = np.column_stack([sine, sine])

    res = compute_loudness_metrics(stereo, sr)
    # ITU-R BS.1770 K-weighting at 1 kHz stereo adds ~ +3.01 dB channel sum vs mono,
    # so identical -14 dBFS RMS on L & R sits near -11.0 LUFS (+/- 0.8 LU tolerance)
    assert -12.0 <= res.integrated_lufs <= -10.0
    assert len(res.short_term_lufs_series) == 5


def test_4x_true_peak_catches_intersample_overshoot(tmp_path: Path) -> None:
    """Signal at fs/4 shifted by pi/4 has sample peaks 3.01 dB lower than continuous peak."""
    sr = 48000
    n = sr * 2
    idx = np.arange(n)
    # Discrete samples hit sin(pi/4 + k*pi/2) = +/- 0.7071 * amp -> sample peak ~ -3.01 dBFS
    # When amp = 1.18, discrete samples are 0.834 (-1.57 dBFS), while continuous wave is +1.44 dBTP!
    amp = 1.18
    sig = amp * np.sin((np.pi / 4.0) + idx * (np.pi / 2.0))
    stereo = np.column_stack([sig, sig])
    wav_path = tmp_path / "isp.wav"
    sf.write(str(wav_path), stereo, sr, subtype="FLOAT")

    peaks = compute_peak_metrics(stereo, sr, source_path=wav_path)
    assert peaks.sample_peak_dbfs < -1.0
    assert peaks.true_peak_dbtp > 0.5  # Caught > +0.5 dBTP inter-sample clipping!


def test_edge_case_digital_silence() -> None:
    sr = 48000
    silence = np.zeros((sr * 4, 2), dtype=np.float64)
    loud = compute_loudness_metrics(silence, sr)
    peaks = compute_peak_metrics(silence, sr)
    stereo = compute_stereo_metrics(silence, sr)
    spec = compute_spectral_profile(silence, sr)

    assert loud.integrated_lufs == -70.0
    assert peaks.sample_peak_dbfs == -120.0
    assert peaks.true_peak_dbtp == -120.0
    assert stereo.phase_correlation_avg == 1.0
    assert all(b.energy_db == -70.0 for b in spec.bands)


def test_edge_case_pure_mono_and_phase_inverted_stereo() -> None:
    sr = 48000
    t = np.arange(sr * 3) / sr
    tone = 0.4 * np.sin(2 * np.pi * 440.0 * t)

    mono = tone[:, np.newaxis]
    mono_stereo = compute_stereo_metrics(mono, sr)
    assert mono_stereo.phase_correlation_avg == 1.0
    assert mono_stereo.stereo_width_ratio == 0.0

    anti_phase = np.column_stack([tone, -tone])
    anti_stereo = compute_stereo_metrics(anti_phase, sr)
    assert anti_stereo.phase_correlation_avg <= -0.99
    assert anti_stereo.stereo_width_ratio >= 0.99


def test_edge_case_96khz_and_3s_clip(tmp_path: Path) -> None:
    sr = 96000
    t = np.arange(sr * 3) / sr
    # Include 18 kHz energy that 22.05 kHz downsampling would destroy
    sig = 0.25 * np.sin(2 * np.pi * 1000.0 * t) + 0.25 * np.sin(2 * np.pi * 16000.0 * t)
    stereo = np.column_stack([sig, sig])
    wav_96 = tmp_path / "hi_res_3s.wav"
    sf.write(str(wav_96), stereo, sr, subtype="PCM_24")

    loaded = load_audio_file(wav_96)
    assert loaded.sample_rate == 96000
    assert loaded.channels == 2
    assert loaded.bit_depth == 24
    assert 2.9 <= loaded.duration_sec <= 3.1

    spec = compute_spectral_profile(loaded.samples, loaded.sample_rate, genre="electronic")
    air_band = next(b for b in spec.bands if b.band == "air")
    assert air_band.energy_db > -25.0  # 16 kHz preserved cleanly!


def test_edge_case_corrupt_header_rejected(tmp_path: Path) -> None:
    bad_wav = tmp_path / "corrupt.wav"
    bad_wav.write_bytes(b"RIFF\x00\x00\x00\x00NOTAWAVEHEADER_GARBAGE_BYTES")
    with pytest.raises(AudioIngestionError):
        load_audio_file(bad_wav)


def test_mp3_ingestion_via_ffmpeg(tmp_path: Path) -> None:
    sr = 44100
    t = np.arange(sr * 2) / sr
    sig = 0.3 * np.sin(2 * np.pi * 440.0 * t)
    wav_src = tmp_path / "src.wav"
    mp3_dst = tmp_path / "src.mp3"
    sf.write(str(wav_src), np.column_stack([sig, sig]), sr)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(wav_src), "-b:a", "192k", str(mp3_dst)],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        pytest.skip("MP3 encoder not available in local FFmpeg build")
    loaded = load_audio_file(mp3_dst)
    assert loaded.sample_rate == 44100
    assert loaded.channels == 2
    assert loaded.duration_sec >= 1.9


def test_vision_never_suppresses_clipping_alert() -> None:
    sr = 48000
    t = np.arange(sr * 4) / sr
    # Heavily clipped signal (+1.5 dBTP)
    sig = 1.2 * np.sin(2 * np.pi * 220.0 * t)
    clipped = np.clip(np.column_stack([sig, sig]), -1.0, 1.0)
    loud = compute_loudness_metrics(clipped, sr)
    peaks = compute_peak_metrics(clipped, sr)
    from app.dsp import compute_dynamics_metrics

    dyn = compute_dynamics_metrics(clipped, peaks.sample_peak_dbfs, peaks.true_peak_dbtp, loud.short_term_max_lufs)
    spec = compute_spectral_profile(clipped, sr, genre="electronic")
    stereo = compute_stereo_metrics(clipped, sr)

    ctx = AnalysisContext(genre="electronic", stage="final_master", artist_vision=["aggressive"])
    findings = evaluate_mix_findings(ctx, 4.0, loud, peaks, dyn, spec, stereo)
    assert any(f.evidence_id == "ev_true_peak_01" and f.severity == "alert" for f in findings)


def test_misaligned_stems_flagged(tmp_path: Path) -> None:
    sr = 48000
    s1 = np.zeros((sr * 4, 2), dtype=np.float64)
    s2 = np.zeros((int(sr * 4.25), 2), dtype=np.float64)  # 250 ms longer -> > 50 ms tolerance
    s1[:, :] = 0.1
    s2[:, :] = 0.1
    p1 = tmp_path / "Kick.wav"
    p2 = tmp_path / "Bass.wav"
    sf.write(str(p1), s1, sr)
    sf.write(str(p2), s2, sr)

    analysis = analyze_user_stems([("Kick.wav", p1), ("Bass.wav", p2)])
    assert analysis.alignment_passed is False
    assert analysis.max_duration_delta_ms >= 200.0
    assert len(analysis.alignment_warnings) >= 1


def test_mixed_channel_and_phase_interaction_stems(tmp_path: Path) -> None:
    sr = 44100
    t = np.arange(sr * 3) / sr
    tone_120 = 0.35 * np.sin(2 * np.pi * 120.0 * t)

    mono_kick = tone_120[:, np.newaxis]
    stereo_inverted_bass = np.column_stack([-tone_120, -tone_120])

    p1 = tmp_path / "Kick_Mono.wav"
    p2 = tmp_path / "Bass_Stereo.wav"
    sf.write(str(p1), mono_kick, sr)
    sf.write(str(p2), stereo_inverted_bass, sr)

    analysis = analyze_user_stems([("Kick_Mono.wav", p1), ("Bass_Stereo.wav", p2)])
    assert analysis.alignment_passed is True
    assert any("channel" in w.lower() for w in analysis.alignment_warnings)
    assert len(analysis.stems) == 2
    assert len(analysis.overlap_matrix) >= 1
    top_pair = analysis.overlap_matrix[0]
    assert top_pair.phase_interaction_corr is not None
    assert top_pair.phase_interaction_corr < -0.5
    assert top_pair.phase_cancellation_risk is True


def test_public_demo_fixtures_dsp_and_revision_improvement(tmp_path: Path) -> None:
    from app.rules import compare_revisions
    from app.services import analyze_audio_to_report

    repo_root = Path(__file__).resolve().parents[2]
    v1_path = repo_root / "frontend" / "public" / "demo" / "demo-flawed-v1.wav"
    v2_path = repo_root / "frontend" / "public" / "demo" / "demo-revised-v2.wav"
    assert v1_path.exists()
    assert v2_path.exists()

    ctx = AnalysisContext(genre="electronic", stage="unmastered_mix", artist_vision=["punchy", "wide"])
    r1, _ = analyze_audio_to_report("demo_s", v1_path, v1_path.name, tmp_path / "p1", "v1", "/v1", ctx)
    r2, _ = analyze_audio_to_report("demo_s", v2_path, v2_path.name, tmp_path / "p2", "v2", "/v2", ctx)

    assert r1.global_metrics.true_peak_dbtp > -0.1
    assert r1.global_metrics.phase_correlation_avg < 0.0
    assert r1.global_metrics.plr_db > 0.0
    assert any(f.evidence_id == "ev_true_peak_01" and f.severity == "alert" for f in r1.findings)
    assert any(f.evidence_id == "ev_phase_01" and f.severity == "alert" for f in r1.findings)

    assert -4.3 <= r2.global_metrics.true_peak_dbtp <= -4.1
    assert r2.global_metrics.phase_correlation_avg >= 0.75

    comp = compare_revisions(r1, r2)
    by_id = {fs.evidence_id: fs for fs in comp.finding_statuses}
    assert by_id["ev_true_peak_01"].status == "improved"
    assert by_id["ev_phase_01"].status == "improved"
    assert by_id["ev_tonal_low_mid_01"].status == "improved"


def test_low_end_sub_phase_correlation_detected() -> None:
    sr = 48000
    t = np.arange(sr * 3, dtype=np.float32) / sr
    sub_l = 0.4 * np.sin(2.0 * np.pi * 60.0 * t)
    sub_r = -sub_l  # Inverted 60 Hz sub-bass
    high_mono = 0.25 * np.sin(2.0 * np.pi * 2000.0 * t)
    stereo = np.column_stack([sub_l + high_mono, sub_r + high_mono]).astype(np.float32)

    res = compute_stereo_metrics(stereo, sr)
    assert res.low_end_phase_correlation <= -0.90

