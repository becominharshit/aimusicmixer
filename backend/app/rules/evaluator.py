from __future__ import annotations

import numpy as np

from app.dsp.dynamics import DynamicsResult
from app.dsp.loudness import LoudnessResult
from app.dsp.peaks import PeakResult
from app.dsp.spectrum import SpectralAnalysisResult
from app.dsp.stereo import StereoResult
from app.schemas.report import (
    AnalysisContext,
    BandName,
    Finding,
    GenreType,
    GlobalMetrics,
    SpectralBand,
    StreamingEstimate,
)

GENRE_MASTER_LOUDNESS_RANGE: dict[GenreType, tuple[float, float]] = {
    "electronic": (-11.0, -7.0),
    "pop": (-12.5, -8.0),
    "hip_hop": (-11.5, -7.5),
    "rock": (-13.0, -8.5),
    "acoustic": (-17.5, -12.0),
    "ambient": (-18.5, -12.5),
    "other": (-14.0, -9.0),
}

BAND_LABELS: dict[BandName, tuple[str, str]] = {
    "sub": ("Sub-Bass", "20–60 Hz"),
    "low": ("Low End", "60–250 Hz"),
    "low_mid": ("Low-Mids", "250–800 Hz"),
    "high_mid": ("Upper-Mids", "800–4,000 Hz"),
    "presence": ("Presence", "4–10 kHz"),
    "air": ("Air / Top End", "10–20 kHz"),
}


def _fmt_time(sec: float) -> str:
    sec = max(0.0, sec)
    mins = int(sec // 60)
    rem = int(round(sec % 60))
    if rem == 60:
        mins += 1
        rem = 0
    return f"{mins:02d}:{rem:02d}"


def compute_streaming_estimates(metrics: GlobalMetrics) -> list[StreamingEstimate]:
    estimates: list[StreamingEstimate] = []

    spotify_gain = round(-14.0 - metrics.integrated_lufs, 2)
    spotify_projected_peak = metrics.true_peak_dbtp + max(0.0, spotify_gain)
    spotify_limiter = spotify_gain > 0.2 and spotify_projected_peak > -1.0
    if spotify_gain > 0.2:
        spotify_note = (
            f"Assumes Normal loudness mode (-14 LUFS target). Positive gain (+{spotify_gain:.1f} dB) "
            f"would raise true peak to {spotify_projected_peak:.1f} dBTP; "
            + (
                "Spotify's client limiter may engage and reshape peaks."
                if spotify_limiter
                else "stays below Spotify's -1.0 dBTP limiter ceiling."
            )
        )
    elif spotify_gain < -0.2:
        spotify_note = (
            f"Assumes Normal loudness mode (-14 LUFS target). Track will be turned down by "
            f"{abs(spotify_gain):.1f} dB with no additional client limiting."
        )
    else:
        spotify_note = "Aligned closely with Spotify Normal (-14 LUFS) target with minimal normalization gain."

    estimates.append(
        StreamingEstimate(
            platform="Spotify (Normal -14 LUFS)",
            estimated_gain_db=spotify_gain,
            limiter_engaged_warning=spotify_limiter,
            assumption_note=spotify_note,
        )
    )

    apple_gain = round(-16.0 - metrics.integrated_lufs, 2)
    apple_projected = metrics.true_peak_dbtp + max(0.0, apple_gain)
    apple_limiter = apple_gain > 0.2 and apple_projected > -1.0
    estimates.append(
        StreamingEstimate(
            platform="Apple Music (Sound Check -16 LUFS)",
            estimated_gain_db=apple_gain,
            limiter_engaged_warning=apple_limiter,
            assumption_note=(
                f"Estimated normalization shift of {apple_gain:+.1f} dB relative to -16 LUFS album/track playback reference."
            ),
        )
    )

    yt_gain = round(min(0.0, -14.0 - metrics.integrated_lufs), 2)
    estimates.append(
        StreamingEstimate(
            platform="YouTube (-14 LUFS, Downward Only)",
            estimated_gain_db=yt_gain,
            limiter_engaged_warning=False,
            assumption_note=(
                f"YouTube attenuates tracks louder than -14 LUFS ({yt_gain:+.1f} dB) and does not apply upward gain to quieter tracks."
            ),
        )
    )

    return estimates


def evaluate_mix_findings(
    context: AnalysisContext,
    duration_sec: float,
    loudness: LoudnessResult,
    peaks: PeakResult,
    dynamics: DynamicsResult,
    spectral: SpectralAnalysisResult,
    stereo: StereoResult,
) -> list[Finding]:
    """Produce deterministic, evidence-cited pedagogical findings ordered by priority."""
    findings: list[Finding] = []
    vision = set(context.artist_vision)

    # 0. Digital silence guard
    if loudness.integrated_lufs <= -68.0 and peaks.sample_peak_dbfs <= -90.0:
        findings.append(
            Finding(
                evidence_id="ev_silence_01",
                category="technical_validation",
                severity="alert",
                classification="objective_defect",
                confidence="measured",
                title="Digital Silence Detected Across File",
                timestamp_start_sec=0.0,
                timestamp_end_sec=round(duration_sec, 1),
                measured_value=f"{loudness.integrated_lufs:.1f} LUFS / {peaks.sample_peak_dbfs:.1f} dBFS",
                what_happened="No audible signal was detected above -90 dBFS across the uploaded file.",
                why_it_matters="Exporting a muted master bus, bypassed range, or wrong output routing produces a silent bounce.",
                listen_prompt="Press play to confirm the file contains silence rather than intended audio.",
                what_to_try="Verify your DAW master bus fader, export locator range, and output channel assignment before re-bouncing.",
                recheck_target="Re-export with signal peaking between -6.0 and -1.0 dBTP.",
            )
        )
        return findings

    # Locate loudest short-term moment for peak/loudness jump prompts
    if loudness.short_term_lufs_series:
        peak_sec = float(int(np.argmax(loudness.short_term_lufs_series)))
    else:
        peak_sec = 0.0
    loud_start = max(0.0, round(peak_sec, 1))
    loud_end = min(round(duration_sec, 1), round(loud_start + min(10.0, max(2.0, duration_sec)), 1))

    # 1. True Peak / Inter-sample clipping (Never suppressed by artist vision!)
    clip_ts = peaks.clipping_timestamps_sec[0] if peaks.clipping_timestamps_sec else loud_start
    clip_end = min(round(duration_sec, 1), round(clip_ts + min(8.0, max(2.0, duration_sec)), 1))

    if peaks.true_peak_dbtp > -0.1:
        findings.append(
            Finding(
                evidence_id="ev_true_peak_01",
                category="true_peak",
                severity="alert",
                classification="objective_defect",
                confidence="measured",
                title=f"Inter-Sample Clipping Risk ({peaks.true_peak_dbtp:+.2f} dBTP)",
                timestamp_start_sec=round(clip_ts, 1),
                timestamp_end_sec=round(max(clip_ts + 1.0, clip_end), 1),
                measured_value=f"{peaks.true_peak_dbtp:+.2f} dBTP (Sample peak {peaks.sample_peak_dbfs:+.2f} dBFS)",
                what_happened=(
                    f"4x oversampled True Peak reaches {peaks.true_peak_dbtp:+.2f} dBTP near {_fmt_time(clip_ts)}, exceeding the -0.1 dBTP digital ceiling"
                    + (" even while aggressive saturation is part of your selected vision." if "aggressive" in vision else ".")
                ),
                why_it_matters="DA converters and lossy streaming encoders (AAC/MP3/Opus) reconstruct waves between samples, turning inter-sample overs into harsh crackle.",
                listen_prompt=f"Jump to {_fmt_time(clip_ts)} and listen closely to kick/snare transients on Full Range and Smartphone previews for brittle crunch.",
                what_to_try=(
                    "Enable True Peak (oversampled) limiting on your final limiter and set output ceiling to -1.0 dBTP for a master, or pull the master fader down 2-3 dB if unmastered."
                    if context.stage == "final_master"
                    else "Lower your drum bus or master fader by 3-5 dB so your unmastered mix retains -3.0 to -6.0 dBTP headroom."
                ),
                recheck_target="Re-export and confirm True Peak sits at or below -1.0 dBTP (final master) or -3.0 dBTP (unmastered mix).",
            )
        )
    elif context.stage == "unmastered_mix" and peaks.true_peak_dbtp > -2.5:
        findings.append(
            Finding(
                evidence_id="ev_true_peak_01",
                category="true_peak",
                severity="caution",
                classification="stylistic_choice",
                confidence="measured",
                title=f"Tight Headroom for an Unmastered Mix ({peaks.true_peak_dbtp:+.2f} dBTP)",
                timestamp_start_sec=round(clip_ts, 1),
                timestamp_end_sec=round(max(clip_ts + 1.0, clip_end), 1),
                measured_value=f"{peaks.true_peak_dbtp:+.2f} dBTP (target -6.0 to -3.0 dBTP)",
                what_happened=f"Your unmastered mix peaks at {peaks.true_peak_dbtp:+.2f} dBTP around {_fmt_time(clip_ts)}, leaving less than 2.5 dB before full scale.",
                why_it_matters="Tight pre-master headroom increases risk of unintended bus clipping and leaves little room for mastering EQ boosts.",
                listen_prompt=f"Audition {_fmt_time(clip_ts)} and check whether loudest drum hits feel pinned against a ceiling.",
                what_to_try="Select all tracks/buses (or trim a pre-fader utility gain before the stereo bus) down by 2.5-3.5 dB rather than altering individual mix balances.",
                recheck_target="Re-export and verify True Peak lands between -6.0 and -3.0 dBTP.",
            )
        )
    elif context.stage == "final_master" and peaks.true_peak_dbtp > -1.0:
        findings.append(
            Finding(
                evidence_id="ev_true_peak_01",
                category="true_peak",
                severity="caution",
                classification="stylistic_choice",
                confidence="measured",
                title=f"Slim Streaming Codec Headroom ({peaks.true_peak_dbtp:+.2f} dBTP)",
                timestamp_start_sec=round(clip_ts, 1),
                timestamp_end_sec=round(max(clip_ts + 1.0, clip_end), 1),
                measured_value=f"{peaks.true_peak_dbtp:+.2f} dBTP (recommended <= -1.0 dBTP)",
                what_happened=f"True Peak measures {peaks.true_peak_dbtp:+.2f} dBTP, sitting between -1.0 and -0.1 dBTP.",
                why_it_matters="Streaming platforms transcode to AAC/Ogg Vorbis, which commonly adds +0.5 to +1.0 dB of inter-sample overshoot on loud masters.",
                listen_prompt=f"Loop {_fmt_time(clip_ts)} to inspect your loudest snare/kick hits.",
                what_to_try="Lower your final limiter output ceiling to -1.0 dBTP (with 4x oversampling/ISP detection enabled).",
                recheck_target="Confirm True Peak measures between -1.2 and -1.0 dBTP.",
            )
        )

    # 2. Stereo Phase Correlation & Mono Translation
    p_start, p_end = stereo.worst_phase_window
    if stereo.phase_correlation_avg < 0.0:
        findings.append(
            Finding(
                evidence_id="ev_phase_01",
                category="stereo_phase",
                severity="alert",
                classification="objective_defect",
                confidence="measured",
                title=f"Severe Stereo Phase Cancellation ({stereo.phase_correlation_avg:+.2f})",
                timestamp_start_sec=p_start,
                timestamp_end_sec=p_end,
                measured_value=f"Correlation {stereo.phase_correlation_avg:+.2f}, Stereo width {stereo.stereo_width_ratio:.2f}",
                what_happened=(
                    f"Average L/R phase correlation is negative ({stereo.phase_correlation_avg:+.2f}), dropping sharpest near {_fmt_time(p_start)}."
                ),
                why_it_matters="When summed to mono (phones, club PAs, smart speakers), opposite-polarity L/R signals cancel each other out and collapse in level.",
                listen_prompt=f"Jump to {_fmt_time(p_start)} and switch Stereo Mode from Stereo to Mono Fold (0.5L + 0.5R) to hear elements hollow out or vanish.",
                what_to_try="Check stereo wideners, Haas delays, or inverted track polarity switches; collapse sub frequencies (< 120 Hz) to mono.",
                recheck_target="Re-export and verify average correlation moves safely above +0.35 (and sub-bass stays near +1.0).",
            )
        )
    elif stereo.phase_correlation_avg < 0.35 or (
        stereo.phase_correlation_series and min(stereo.phase_correlation_series) < 0.1
    ):
        min_corr = min(stereo.phase_correlation_series) if stereo.phase_correlation_series else stereo.phase_correlation_avg
        findings.append(
            Finding(
                evidence_id="ev_phase_01",
                category="stereo_phase",
                severity="caution",
                classification="stylistic_choice",
                confidence="measured",
                title=f"Mono Compatibility Risk in Wide Section ({min_corr:+.2f})",
                timestamp_start_sec=p_start,
                timestamp_end_sec=p_end,
                measured_value=f"Min correlation {min_corr:+.2f} (Avg {stereo.phase_correlation_avg:+.2f})",
                what_happened=(
                    f"Stereo correlation dips to {min_corr:+.2f} around {_fmt_time(p_start)}"
                    + (" while pursuing your Wide vision profile." if "wide" in vision else ".")
                ),
                why_it_matters="Excessive side energy (< +0.2 correlation) loses body and punch when played on mono phone speakers or summed club systems.",
                listen_prompt=f"Toggle Stereo vs. Mono Fold around {_fmt_time(p_start)} to judge whether lead or synth layers lose presence.",
                what_to_try="Use mid/side EQ to high-pass Side energy below 150 Hz and slightly dial back stereo chorus/Haas width on main hooks.",
                recheck_target="Target minimum 1-second phase correlation >= +0.25 while keeping your wide feel in stereo.",
            )
        )

    if stereo.low_end_phase_correlation < 0.30:
        low_sev = "alert" if stereo.low_end_phase_correlation < 0.0 else "caution"
        findings.append(
            Finding(
                evidence_id="ev_phase_low_01",
                category="stereo_phase",
                severity=low_sev,
                classification="objective_defect",
                confidence="measured",
                band_name="sub",
                title=f"Wide / Uncentered Sub-Bass Below 120 Hz ({stereo.low_end_phase_correlation:+.2f})",
                timestamp_start_sec=p_start,
                timestamp_end_sec=p_end,
                measured_value=f"20-120 Hz correlation {stereo.low_end_phase_correlation:+.2f} (recommended >= +0.70)",
                what_happened=(
                    f"4th-order Butterworth 20-120 Hz bandpass correlation measures {stereo.low_end_phase_correlation:+.2f}, indicating significant Side energy in the low end."
                ),
                why_it_matters="Stereo sub-bass suffers heavy cancellation in mono playback (club PAs, phone speakers) and wastes headroom on vinyl or streaming masters.",
                listen_prompt=f"Switch Stereo Mode to Mono Fold around {_fmt_time(p_start)} and listen to kick/sub weight drop or hollow out.",
                what_to_try="Insert a Mid/Side EQ on your master or bass bus and high-pass the Side channel at 100–130 Hz so sub frequencies sum cleanly in mono.",
                recheck_target="Confirm 20-120 Hz phase correlation climbs above +0.70.",
            )
        )

    # 3. Spectral Tonal Balance Findings
    band_candidates: list[tuple[float, SpectralBand]] = []
    for sb in spectral.bands:
        threshold = 2.2 if sb.band in {"low", "low_mid", "high_mid"} else 2.8
        if abs(sb.delta_vs_genre_median_db) >= threshold:
            band_candidates.append((abs(sb.delta_vs_genre_median_db), sb))
    band_candidates.sort(key=lambda x: x[0], reverse=True)

    for _, sb in band_candidates[:3]:
        label, hz_text = BAND_LABELS[sb.band]
        w_start, w_end = spectral.band_peak_windows.get(sb.band, (loud_start, loud_end))
        delta = sb.delta_vs_genre_median_db
        direction = "Excess" if delta > 0 else "Recessed"
        severity = "alert" if abs(delta) >= 5.0 else "caution"

        if sb.band in {"sub", "low"} and delta > 0:
            title = f"{label} Buildup Around {hz_text}"
            why = "Excess low-end energy eats headroom early on limiters and causes boomy, muddy kick/bass blur on small speakers."
            listen = f"Jump to {_fmt_time(w_start)} and switch between Full Range, Laptop, and Smartphone previews to hear if low notes mask the midrange."
            try_hint = (
                "Check high-pass filters on non-bass instruments around 100-140 Hz, or apply a gentle 1.5-3.0 dB dynamic EQ cut near 120-180 Hz."
                if sb.band == "low"
                else "Trim sub-45 Hz rumble on non-sub tracks and verify kick/sub phase alignment below 60 Hz."
            )
            recheck = f"Re-export and check {hz_text} relative delta settles within +/-1.8 dB of your {context.genre} median."
        elif sb.band == "low_mid" and delta > 0:
            title = f"Boxy Low-Mid Congestion ({hz_text})"
            why = "Energy piling up between 250 and 800 Hz clouds vocal clarity and creates a cardboard-like resonance on laptops."
            listen = f"Audition {_fmt_time(w_start)} on the Laptop translation profile to hear whether chords and snare body crowd the center."
            try_hint = "Sweep gently between 300 and 550 Hz on congested synth/guitar buses with a 1.5-2.5 dB wide-Q cut."
            recheck = f"Verify {hz_text} delta drops within +/-1.8 dB without thinning out warmth."
        elif sb.band == "high_mid" and delta > 0:
            title = f"Forward Upper-Mids / Harshness Risk ({hz_text})"
            why = "Excess 800 Hz - 4 kHz energy causes rapid ear fatigue and turns shrill on smartphone speakers."
            listen = f"Switch to the Smartphone preview at {_fmt_time(w_start)}—if vocals or leads pierce uncomfortably, tame this pocket."
            try_hint = "Try a dynamic EQ dip of 1.5-2.5 dB around 2.2-3.5 kHz triggered only on loud vocal/synth peaks."
            recheck = f"Confirm {hz_text} delta moves within +/-2.0 dB."
        elif sb.band in {"presence", "air"} and delta < 0:
            warm_note = " (consistent with a Warm profile, though worth checking clarity)" if "warm" in vision else ""
            title = f"Dark / Recessed {label} ({hz_text}){warm_note}"
            why = "Under-represented upper frequencies can make a mix sound veiled behind a blanket next to commercial releases."
            listen = f"A/B against a loudness-matched reference track around {_fmt_time(w_start)} and check hi-hat/vocal air."
            try_hint = "Add a gentle +1.0 to +2.0 dB high shelf above 6-10 kHz on vocals/overheads, or parallel bright exciter."
            recheck = f"Verify {hz_text} balance sits within +/-2.2 dB of your genre reference envelope."
        else:
            title = f"{label} {direction} ({hz_text}: {delta:+.1f} dB)"
            why = f"A {abs(delta):.1f} dB departure from typical {context.genre} spectral tilt shifts perceived tonal weight across playback systems."
            listen = f"Loop {_fmt_time(w_start)} and toggle Laptop and Smartphone previews to check translation."
            try_hint = (
                f"Apply a broad 1.5-2.5 dB trim in {hz_text} on the dominant group bus."
                if delta > 0
                else f"Check whether {hz_text} was over-attenuated by heavy low/high-pass filtering and restore 1-2 dB smoothly."
            )
            recheck = f"Target {hz_text} delta within +/-2.0 dB of the genre profile."

        findings.append(
            Finding(
                evidence_id=f"ev_tonal_{sb.band}_01",
                category="tonal_balance",
                severity=severity,
                classification="stylistic_choice",
                confidence="measured",
                band_name=sb.band,
                title=title,
                timestamp_start_sec=w_start,
                timestamp_end_sec=w_end,
                measured_value=f"{delta:+.1f} dB vs {context.genre} median ({sb.energy_db:.1f} dB band energy)",
                what_happened=f"Energy in {hz_text} measures {delta:+.1f} dB relative to typical {context.genre} balance, peaking near {_fmt_time(w_start)}.",
                why_it_matters=why,
                listen_prompt=listen,
                what_to_try=try_hint,
                recheck_target=recheck,
            )
        )

    # 4. Loudness & Dynamics Context
    target_low, target_high = GENRE_MASTER_LOUDNESS_RANGE.get(context.genre, (-14.0, -9.0))
    if context.stage == "unmastered_mix" and loudness.integrated_lufs > -11.5:
        findings.append(
            Finding(
                evidence_id="ev_loudness_01",
                category="loudness",
                severity="caution",
                confidence="measured",
                title=f"Unmastered Mix Already Loud ({loudness.integrated_lufs:.1f} LUFS)",
                timestamp_start_sec=loud_start,
                timestamp_end_sec=loud_end,
                measured_value=f"{loudness.integrated_lufs:.1f} LUFS (typical unmastered: -22 to -14 LUFS)",
                what_happened=f"Integrated loudness is {loudness.integrated_lufs:.1f} LUFS despite being tagged as an Unmastered Mix.",
                why_it_matters="Heavy mix-bus limiting before mastering locks in distortion and prevents a clean mastering stage.",
                listen_prompt=f"Audition {_fmt_time(loud_start)} and compare transient snap against a loudness-matched reference.",
                what_to_try="Bypass any temporary master limiter used for loudness previewing and aim for -18 to -14 LUFS on the pre-master bounce.",
                recheck_target="Verify integrated loudness moves into -20 to -14 LUFS with >= 3.0 dBTP headroom.",
            )
        )
    elif context.stage == "final_master" and loudness.integrated_lufs < target_low - 2.0:
        findings.append(
            Finding(
                evidence_id="ev_loudness_01",
                category="loudness",
                severity="caution",
                confidence="measured",
                title=f"Conservative Master Loudness ({loudness.integrated_lufs:.1f} LUFS)",
                timestamp_start_sec=loud_start,
                timestamp_end_sec=loud_end,
                measured_value=f"{loudness.integrated_lufs:.1f} LUFS (typical {context.genre}: {target_low:.0f} to {target_high:.0f} LUFS)",
                what_happened=f"Your final master measures {loudness.integrated_lufs:.1f} LUFS, quieter than most {context.genre} releases (though streaming platforms normalize upward/downward).",
                why_it_matters="Spotify Normal (-14 LUFS) will add upward gain; if True Peak is already near -1.0 dBTP, client limiting could engage.",
                listen_prompt=f"Check Streaming Normalization estimates and audition {_fmt_time(loud_start)}.",
                what_to_try="If intentional for a Dynamic profile, keep it! Otherwise gently drive 1-2 dB into a transparent limiter with -1.0 dBTP ceiling.",
                recheck_target="Confirm integrated loudness and Spotify Normal gain stay free of client limiter engagement.",
            )
        )

    if dynamics.psr_db > 0 and (dynamics.psr_db < 6.0 or dynamics.crest_factor_db < 7.0):
        vision_note = (
            " This aligns with your Aggressive profile, though extreme density still carries streaming translation risks."
            if "aggressive" in vision
            else " If you selected a Dynamic or Punchy goal, transient punch may be over-compressed."
        )
        findings.append(
            Finding(
                evidence_id="ev_dynamics_01",
                category="dynamics",
                severity="caution",
                confidence="measured",
                title=f"Compressed Transient Density (PSR {dynamics.psr_db:.1f} dB)",
                timestamp_start_sec=loud_start,
                timestamp_end_sec=loud_end,
                measured_value=f"PSR {dynamics.psr_db:.1f} dB, Crest Factor {dynamics.crest_factor_db:.1f} dB",
                what_happened=f"Peak-to-Short-Term Loudness Ratio measures {dynamics.psr_db:.1f} dB during the loudest section.{vision_note}",
                why_it_matters="When PSR drops below 6 dB, kick and snare transients flatten out, making drops feel smaller after streaming loudness matching.",
                listen_prompt=f"Level-match a reference track at {_fmt_time(loud_start)} and listen specifically to snare attack and vocal breath.",
                what_to_try="Back off master limiter threshold by 1-2 dB or lengthen drum bus compressor attack (15-30 ms) so transients punch through.",
                recheck_target="Re-export and aim for PSR >= 7.0 dB and Crest Factor >= 8.5 dB.",
            )
        )

    if 0.0 < dynamics.transient_punch_db < 4.5 and (dynamics.psr_db < 8.5 or dynamics.crest_factor_db < 10.0):
        punch_sev = "alert" if dynamics.transient_punch_db < 3.0 else "caution"
        findings.append(
            Finding(
                evidence_id="ev_transient_crush_01",
                category="dynamics",
                severity=punch_sev,
                classification="objective_defect" if punch_sev == "alert" else "stylistic_choice",
                confidence="measured",
                title=f"Over-Limited / Crushed Transients ({dynamics.transient_punch_db:.1f} dB punch)",
                timestamp_start_sec=loud_start,
                timestamp_end_sec=loud_end,
                measured_value=f"Transient punch {dynamics.transient_punch_db:.1f} dB (10 ms attack vs 200 ms body RMS)",
                what_happened=(
                    f"Short-term 10 ms attack energy sits only {dynamics.transient_punch_db:.1f} dB above the 200 ms body RMS near {_fmt_time(loud_start)}, indicating heavy transient shaving."
                ),
                why_it_matters="Over-limiting shaves kick and snare impact, causing listener fatigue and making the mix sound smaller than punchier releases once streaming loudness-matches playback.",
                listen_prompt=f"Audition {_fmt_time(loud_start)} and compare drum snap against a loudness-matched reference track.",
                what_to_try="Pull back final limiter input drive by 1.5–2.5 dB, slow drum bus compressor attack to 20–30 ms, or use a gentle soft clipper before limiting.",
                recheck_target="Re-export and verify Transient Punch climbs above 5.0 dB without sacrificing perceived impact.",
            )
        )

    # 5. Ensure positive, verifiable baseline confirmations so the 3-card Simple Check is always complete & honest
    if not any(f.category == "true_peak" for f in findings):
        findings.append(
            Finding(
                evidence_id="ev_true_peak_safe_01",
                category="true_peak",
                severity="safe",
                confidence="measured",
                title=f"Healthy Peak Headroom ({peaks.true_peak_dbtp:+.2f} dBTP)",
                timestamp_start_sec=loud_start,
                timestamp_end_sec=loud_end,
                measured_value=f"{peaks.true_peak_dbtp:+.2f} dBTP (Sample peak {peaks.sample_peak_dbfs:+.2f} dBFS)",
                what_happened=f"4x oversampled True Peak stays cleanly below ceiling at {peaks.true_peak_dbtp:+.2f} dBTP.",
                why_it_matters="Safe true-peak headroom protects your transients during AAC/MP3 streaming transcodes and mastering processing.",
                listen_prompt=f"Audition {_fmt_time(loud_start)} to confirm clean transient clarity with zero digital clipping.",
                what_to_try="No peak reduction needed—keep your current ceiling discipline as you refine tonal balance.",
                recheck_target="Maintain True Peak <= -1.0 dBTP (final master) or <= -3.0 dBTP (unmastered mix).",
            )
        )

    if not any(f.category == "stereo_phase" for f in findings):
        findings.append(
            Finding(
                evidence_id="ev_phase_safe_01",
                category="stereo_phase",
                severity="safe",
                confidence="measured",
                title=f"Solid Mono Phase Translation ({stereo.phase_correlation_avg:+.2f})",
                timestamp_start_sec=loud_start,
                timestamp_end_sec=loud_end,
                measured_value=f"Avg correlation {stereo.phase_correlation_avg:+.2f}, Sub <120Hz {stereo.low_end_phase_correlation:+.2f}, Width {stereo.stereo_width_ratio:.2f}",
                what_happened=f"L/R phase correlation averages {stereo.phase_correlation_avg:+.2f} (sub-120 Hz {stereo.low_end_phase_correlation:+.2f}) with healthy Mid/Side balance.",
                why_it_matters="Positive correlation ensures your mix holds together without hollowing out on mono phone speakers or club PAs.",
                listen_prompt=f"Toggle Stereo and Mono Fold around {_fmt_time(loud_start)} to verify snare and bass weight stay locked.",
                what_to_try="Preserve this stereo foundation if you add spatial effects later—keep sub-bass mono below 120 Hz.",
                recheck_target="Keep average correlation above +0.40 after final tweaks.",
            )
        )

    if len(findings) < 3:
        findings.append(
            Finding(
                evidence_id="ev_dynamics_safe_01",
                category="dynamics",
                severity="safe",
                confidence="measured",
                title=f"Balanced Dynamic Contrast (PSR {dynamics.psr_db:.1f} dB)",
                timestamp_start_sec=loud_start,
                timestamp_end_sec=loud_end,
                measured_value=f"PSR {dynamics.psr_db:.1f} dB, LRA {loudness.loudness_range_lu:.1f} LU",
                what_happened=f"Crest factor ({dynamics.crest_factor_db:.1f} dB) and PSR ({dynamics.psr_db:.1f} dB) preserve clear rhythmic punch.",
                why_it_matters="Healthy transient-to-body ratio keeps mixes exciting at both quiet and loud playback volumes.",
                listen_prompt=f"Listen across {_fmt_time(loud_start)} with Device Lab toggled between Full Range and Smartphone.",
                what_to_try="Use a loudness-matched reference track in Advanced Mode to verify macro energy arc between verse and drop.",
                recheck_target="Maintain PSR >= 7.0 dB across revisions.",
            )
        )

    severity_rank = {"alert": 0, "caution": 1, "safe": 2}
    findings.sort(key=lambda f: severity_rank.get(f.severity, 3))
    return findings
