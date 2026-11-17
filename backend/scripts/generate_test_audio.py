"""Generate copyright-free synthetic studio test assets in assets/test-audio/."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt


def _make_musical_stems(sr: int = 48000, duration_sec: float = 16.0) -> dict[str, np.ndarray]:
    n = int(sr * duration_sec)
    t = np.arange(n) / sr
    bpm = 120.0
    beat_period = 60.0 / bpm  # 0.5s per beat

    # 1. Kick stem (centered mono-in-stereo, 52 Hz thump + click transient)
    kick_mono = np.zeros(n, dtype=np.float64)
    beat_samples = int(beat_period * sr)
    kick_len = int(0.32 * sr)
    tk = np.arange(kick_len) / sr
    kick_freq = 125.0 * np.exp(-tk / 0.038) + 48.0
    kick_phase = 2.0 * np.pi * np.cumsum(kick_freq) / sr
    kick_hit = np.sin(kick_phase) * np.exp(-tk / 0.11) * (1.0 - np.exp(-tk / 0.002))
    for start in range(0, n - kick_len, beat_samples):
        kick_mono[start : start + kick_len] += 0.68 * kick_hit
    kick = np.column_stack([kick_mono, kick_mono])

    # 2. Bass stem (110 Hz + 220 Hz harmonic — intentional low-end buildup in v1!)
    bass_mono = np.zeros(n, dtype=np.float64)
    sub_notes = [55.0, 55.0, 65.41, 49.0]  # A1, A1, C2, G1
    bar_samples = beat_samples * 4
    for idx, start in enumerate(range(0, n, bar_samples)):
        end = min(n, start + bar_samples)
        f0 = sub_notes[idx % len(sub_notes)]
        tb = np.arange(end - start) / sr
        env = np.sin(np.pi * (tb % beat_period) / beat_period) ** 0.45
        wave = (
            0.35 * np.sin(2 * np.pi * f0 * tb)
            + 0.42 * np.sin(2 * np.pi * (f0 * 2.0) * tb)  # strong 110 Hz buildup
            + 0.14 * np.sin(2 * np.pi * (f0 * 3.0) * tb)
        )
        bass_mono[start:end] = env * wave * 0.58
    bass = np.column_stack([bass_mono * 0.98, bass_mono * 1.02])

    # 3. Synth pad/arp stem (wide stereo chorus & shimmer)
    chord_freqs = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66), (164.81, 196.0, 246.94)]
    synth_l = np.zeros(n, dtype=np.float64)
    synth_r = np.zeros(n, dtype=np.float64)
    for idx, start in enumerate(range(0, n, bar_samples)):
        end = min(n, start + bar_samples)
        ts = np.arange(end - start) / sr
        notes = chord_freqs[idx % len(chord_freqs)]
        pad_l = sum(np.sin(2 * np.pi * f * ts) + 0.35 * np.sin(2 * np.pi * f * 2 * ts) for f in notes)
        pad_r = sum(np.sin(2 * np.pi * (f * 1.004) * ts + 0.4) + 0.35 * np.sin(2 * np.pi * f * 2.005 * ts + 0.7) for f in notes)
        lfo = 0.75 + 0.25 * np.sin(2 * np.pi * 2.0 * ts)
        synth_l[start:end] = 0.08 * lfo * pad_l
        synth_r[start:end] = 0.08 * lfo * pad_r
    # Clean sub on synth so it stays warm without fighting sub directly
    hp_sos = butter(2, 130.0, btype="highpass", fs=sr, output="sos")
    synth = np.column_stack([sosfilt(hp_sos, synth_l), sosfilt(hp_sos, synth_r)])

    # 4. Drums / Hats stem (filtered crisp noise hats + snare clap on beats 2 & 4)
    rng = np.random.default_rng(42)
    drums_l = np.zeros(n, dtype=np.float64)
    drums_r = np.zeros(n, dtype=np.float64)
    eighth = beat_samples // 2
    hat_len = int(0.08 * sr)
    th = np.arange(hat_len) / sr
    hp_hat = butter(3, 5500.0, btype="highpass", fs=sr, output="sos")
    for idx, start in enumerate(range(0, n - hat_len, eighth)):
        noise = sosfilt(hp_hat, rng.normal(0, 1, hat_len))
        amp = 0.16 if idx % 2 == 1 else 0.08
        env = np.exp(-th / (0.025 if idx % 2 == 0 else 0.045))
        drums_l[start : start + hat_len] += amp * env * noise * (1.1 if idx % 2 else 0.9)
        drums_r[start : start + hat_len] += amp * env * noise * (0.9 if idx % 2 else 1.1)

    snare_len = int(0.18 * sr)
    tsn = np.arange(snare_len) / sr
    bp_snare = butter(2, [220.0, 4200.0], btype="bandpass", fs=sr, output="sos")
    for beat_idx, start in enumerate(range(0, n - snare_len, beat_samples)):
        if beat_idx % 2 == 1:
            body = 0.22 * np.sin(2 * np.pi * 190.0 * tsn) * np.exp(-tsn / 0.06)
            crack = 0.24 * sosfilt(bp_snare, rng.normal(0, 1, snare_len)) * np.exp(-tsn / 0.08)
            drums_l[start : start + snare_len] += body + crack
            drums_r[start : start + snare_len] += body + crack

    drums = np.column_stack([drums_l, drums_r])
    return {"Kick": kick, "Bass": bass, "Synth": synth, "Drums": drums}


def _peaking_eq(x: np.ndarray, sr: int, freq_hz: float, gain_db: float, q: float = 1.0) -> np.ndarray:
    """Biquad peaking filter to craft realistic v1 buildup vs v2 correction."""
    A = 10 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * freq_hz / sr
    alpha = np.sin(w0) / (2.0 * q)
    b0 = 1.0 + alpha * A
    b1 = -2.0 * np.cos(w0)
    b2 = 1.0 - alpha * A
    a0 = 1.0 + alpha / A
    a1 = -2.0 * np.cos(w0)
    a2 = 1.0 - alpha / A
    sos = np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])
    return np.column_stack([sosfilt(sos, x[:, 0]), sosfilt(sos, x[:, 1])])


def main() -> None:
    out_dir = Path(__file__).resolve().parents[2] / "assets" / "test-audio"
    stems_dir = out_dir / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)

    sr = 48000
    stems = _make_musical_stems(sr=sr, duration_sec=16.0)
    for name, arr in stems.items():
        sf.write(str(stems_dir / f"{name}.wav"), arr, sr, subtype="PCM_24")

    raw_sum = stems["Kick"] + stems["Bass"] + stems["Synth"] + stems["Drums"]

    # v1: Intentional low-end buildup around 125 Hz and hot -0.18 dBTP near-clipping level
    v1_boosted = _peaking_eq(raw_sum, sr, freq_hz=125.0, gain_db=4.5, q=0.9)
    v1_peak = float(np.max(np.abs(v1_boosted)))
    v1 = v1_boosted * (0.975 / max(v1_peak, 1e-6))  # ~ -0.22 dBFS / near 0 dBTP
    sf.write(str(out_dir / "unmastered_mix_v1.wav"), v1, sr, subtype="PCM_24")

    # v2: Improved mix with 125 Hz cleaned up, gentle air lift, and safe -3.5 dBFS headroom
    v2_clean = _peaking_eq(raw_sum, sr, freq_hz=125.0, gain_db=-2.2, q=0.9)
    v2_air = _peaking_eq(v2_clean, sr, freq_hz=7500.0, gain_db=1.8, q=0.7)
    v2_peak = float(np.max(np.abs(v2_air)))
    v2 = v2_air * (0.64 / max(v2_peak, 1e-6))  # ~ -3.8 dBFS headroom
    sf.write(str(out_dir / "revised_mix_v2.wav"), v2, sr, subtype="PCM_24")

    # Reference track: balanced master around -14 LUFS and -1.2 dBFS peak
    ref_base = _peaking_eq(raw_sum, sr, freq_hz=125.0, gain_db=-1.5, q=0.9)
    ref_air = _peaking_eq(ref_base, sr, freq_hz=6500.0, gain_db=2.0, q=0.7)
    ref_soft = np.tanh(ref_air * 1.15) * 0.85
    sf.write(str(out_dir / "reference_track.wav"), ref_soft, sr, subtype="PCM_24")

    print(f"Generated synthetic studio assets in {out_dir}")


if __name__ == "__main__":
    main()
