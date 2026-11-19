import type {
  AnalysisContext,
  BandName,
  Finding,
  GenreType,
  GlobalMetrics,
  SpectralBand,
  StreamingEstimate,
} from "@/types/report";
import type { DynamicsResult } from "../dsp/dynamics";
import type { LoudnessResult } from "../dsp/loudness";
import type { PeakResult } from "../dsp/peaks";
import type { SpectralAnalysisResult } from "../dsp/spectrum";
import type { StereoResult } from "../dsp/stereo";

export const GENRE_MASTER_LOUDNESS_RANGE: Record<GenreType, [number, number]> = {
  electronic: [-11.0, -7.0],
  pop: [-12.5, -8.0],
  hip_hop: [-11.5, -7.5],
  rock: [-13.0, -8.5],
  acoustic: [-17.5, -12.0],
  ambient: [-18.5, -12.5],
  other: [-14.0, -9.0],
};

export const BAND_LABELS: Record<BandName, [string, string]> = {
  sub: ["Sub-Bass", "20–60 Hz"],
  low: ["Low End", "60–250 Hz"],
  low_mid: ["Low-Mids", "250–800 Hz"],
  high_mid: ["Upper-Mids", "800–4,000 Hz"],
  presence: ["Presence", "4–10 kHz"],
  air: ["Air / Top End", "10–20 kHz"],
};

function fmtTime(secInput: number): string {
  const sec = Math.max(0.0, secInput);
  let mins = Math.floor(sec / 60);
  let rem = Math.round(sec % 60);
  if (rem === 60) {
    mins += 1;
    rem = 0;
  }
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

export function computeStreamingEstimates(metrics: GlobalMetrics): StreamingEstimate[] {
  const estimates: StreamingEstimate[] = [];

  const spotifyGain = Math.round((-14.0 - metrics.integrated_lufs) * 100) / 100;
  const spotifyProjected = metrics.true_peak_dbtp + Math.max(0.0, spotifyGain);
  const spotifyLimiter = spotifyGain > 0.2 && spotifyProjected > -1.0;
  let spotifyNote: string;
  if (spotifyGain > 0.2) {
    spotifyNote =
      `Assumes Normal loudness mode (-14 LUFS target). Positive gain (+${spotifyGain.toFixed(1)} dB) ` +
      `would raise true peak to ${spotifyProjected.toFixed(1)} dBTP; ` +
      (spotifyLimiter
        ? "Spotify's client limiter may engage and reshape peaks."
        : "stays below Spotify's -1.0 dBTP limiter ceiling.");
  } else if (spotifyGain < -0.2) {
    spotifyNote = `Assumes Normal loudness mode (-14 LUFS target). Track will be turned down by ${Math.abs(spotifyGain).toFixed(1)} dB with no additional client limiting.`;
  } else {
    spotifyNote = "Aligned closely with Spotify Normal (-14 LUFS) target with minimal normalization gain.";
  }

  estimates.push({
    platform: "Spotify (Normal -14 LUFS)",
    estimated_gain_db: spotifyGain,
    limiter_engaged_warning: spotifyLimiter,
    assumption_note: spotifyNote,
  });

  const appleGain = Math.round((-16.0 - metrics.integrated_lufs) * 100) / 100;
  const appleProjected = metrics.true_peak_dbtp + Math.max(0.0, appleGain);
  const appleLimiter = appleGain > 0.2 && appleProjected > -1.0;
  estimates.push({
    platform: "Apple Music (Sound Check -16 LUFS)",
    estimated_gain_db: appleGain,
    limiter_engaged_warning: appleLimiter,
    assumption_note: `Estimated normalization shift of ${appleGain >= 0 ? "+" : ""}${appleGain.toFixed(1)} dB relative to -16 LUFS album/track playback reference.`,
  });

  const ytGain = Math.round(Math.min(0.0, -14.0 - metrics.integrated_lufs) * 100) / 100;
  estimates.push({
    platform: "YouTube (-14 LUFS, Downward Only)",
    estimated_gain_db: ytGain,
    limiter_engaged_warning: false,
    assumption_note: `YouTube attenuates tracks louder than -14 LUFS (${ytGain >= 0 ? "+" : ""}${ytGain.toFixed(1)} dB) and does not apply upward gain to quieter tracks.`,
  });

  return estimates;
}

export function evaluateMixFindings(
  context: AnalysisContext,
  durationSec: number,
  loudness: LoudnessResult,
  peaks: PeakResult,
  dynamics: DynamicsResult,
  spectral: SpectralAnalysisResult,
  stereo: StereoResult
): Finding[] {
  const findings: Finding[] = [];
  const vision = new Set(context.artist_vision);

  if (loudness.integratedLufs <= -68.0 && peaks.samplePeakDbfs <= -90.0) {
    findings.push({
      evidence_id: "ev_silence_01",
      category: "technical_validation",
      severity: "alert",
      classification: "objective_defect",
      confidence: "measured",
      title: "Digital Silence Detected Across File",
      timestamp_start_sec: 0.0,
      timestamp_end_sec: Math.round(durationSec * 10) / 10,
      measured_value: `${loudness.integratedLufs.toFixed(1)} LUFS / ${peaks.samplePeakDbfs.toFixed(1)} dBFS`,
      what_happened: "No audible signal was detected above -90 dBFS across the uploaded file.",
      why_it_matters: "Exporting a muted master bus, bypassed range, or wrong output routing produces a silent bounce.",
      listen_prompt: "Press play to confirm the file contains silence rather than intended audio.",
      what_to_try: "Verify your DAW master bus fader, export locator range, and output channel assignment before re-bouncing.",
      recheck_target: "Re-export with signal peaking between -6.0 and -1.0 dBTP.",
    });
    return findings;
  }

  let peakSec = 0.0;
  if (loudness.shortTermLufsSeries.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < loudness.shortTermLufsSeries.length; i++) {
      if (loudness.shortTermLufsSeries[i] > loudness.shortTermLufsSeries[bestIdx]) {
        bestIdx = i;
      }
    }
    peakSec = bestIdx;
  }
  const loudStart = Math.max(0.0, Math.round(peakSec * 10) / 10);
  const loudEnd = Math.min(
    Math.round(durationSec * 10) / 10,
    Math.round((loudStart + Math.min(10.0, Math.max(2.0, durationSec))) * 10) / 10
  );

  // 1. True Peak / Inter-sample clipping
  const clipTs =
    peaks.clippingTimestampsSec.length > 0 ? peaks.clippingTimestampsSec[0] : loudStart;
  const clipEnd = Math.min(
    Math.round(durationSec * 10) / 10,
    Math.round((clipTs + Math.min(8.0, Math.max(2.0, durationSec))) * 10) / 10
  );
  const fmtTp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

  if (peaks.truePeakDbtp > -0.1) {
    findings.push({
      evidence_id: "ev_true_peak_01",
      category: "true_peak",
      severity: "alert",
      classification: "objective_defect",
      confidence: "measured",
      title: `Inter-Sample Clipping Risk (${fmtTp(peaks.truePeakDbtp)} dBTP)`,
      timestamp_start_sec: Math.round(clipTs * 10) / 10,
      timestamp_end_sec: Math.round(Math.max(clipTs + 1.0, clipEnd) * 10) / 10,
      measured_value: `${fmtTp(peaks.truePeakDbtp)} dBTP (Sample peak ${fmtTp(peaks.samplePeakDbfs)} dBFS)`,
      what_happened:
        `4x oversampled True Peak reaches ${fmtTp(peaks.truePeakDbtp)} dBTP near ${fmtTime(clipTs)}, exceeding the -0.1 dBTP digital ceiling` +
        (vision.has("aggressive") ? " even while aggressive saturation is part of your selected vision." : "."),
      why_it_matters:
        "DA converters and lossy streaming encoders (AAC/MP3/Opus) reconstruct waves between samples, turning inter-sample overs into harsh crackle.",
      listen_prompt: `Jump to ${fmtTime(clipTs)} and listen closely to kick/snare transients on Full Range and Smartphone previews for brittle crunch.`,
      what_to_try:
        context.stage === "final_master"
          ? "Enable True Peak (oversampled) limiting on your final limiter and set output ceiling to -1.0 dBTP for a master, or pull the master fader down 2-3 dB if unmastered."
          : "Lower your drum bus or master fader by 3-5 dB so your unmastered mix retains -3.0 to -6.0 dBTP headroom.",
      recheck_target: "Re-export and confirm True Peak sits at or below -1.0 dBTP (final master) or -3.0 dBTP (unmastered mix).",
    });
  } else if (context.stage === "unmastered_mix" && peaks.truePeakDbtp > -2.5) {
    findings.push({
      evidence_id: "ev_true_peak_01",
      category: "true_peak",
      severity: "caution",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Tight Headroom for an Unmastered Mix (${fmtTp(peaks.truePeakDbtp)} dBTP)`,
      timestamp_start_sec: Math.round(clipTs * 10) / 10,
      timestamp_end_sec: Math.round(Math.max(clipTs + 1.0, clipEnd) * 10) / 10,
      measured_value: `${fmtTp(peaks.truePeakDbtp)} dBTP (target -6.0 to -3.0 dBTP)`,
      what_happened: `Your unmastered mix peaks at ${fmtTp(peaks.truePeakDbtp)} dBTP around ${fmtTime(clipTs)}, leaving less than 2.5 dB before full scale.`,
      why_it_matters: "Tight pre-master headroom increases risk of unintended bus clipping and leaves little room for mastering EQ boosts.",
      listen_prompt: `Audition ${fmtTime(clipTs)} and check whether loudest drum hits feel pinned against a ceiling.`,
      what_to_try: "Select all tracks/buses (or trim a pre-fader utility gain before the stereo bus) down by 2.5-3.5 dB rather than altering individual mix balances.",
      recheck_target: "Re-export and verify True Peak lands between -6.0 and -3.0 dBTP.",
    });
  } else if (context.stage === "final_master" && peaks.truePeakDbtp > -1.0) {
    findings.push({
      evidence_id: "ev_true_peak_01",
      category: "true_peak",
      severity: "caution",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Slim Streaming Codec Headroom (${fmtTp(peaks.truePeakDbtp)} dBTP)`,
      timestamp_start_sec: Math.round(clipTs * 10) / 10,
      timestamp_end_sec: Math.round(Math.max(clipTs + 1.0, clipEnd) * 10) / 10,
      measured_value: `${fmtTp(peaks.truePeakDbtp)} dBTP (recommended <= -1.0 dBTP)`,
      what_happened: `True Peak measures ${fmtTp(peaks.truePeakDbtp)} dBTP, sitting between -1.0 and -0.1 dBTP.`,
      why_it_matters: "Streaming platforms transcode to AAC/Ogg Vorbis, which commonly adds +0.5 to +1.0 dB of inter-sample overshoot on loud masters.",
      listen_prompt: `Loop ${fmtTime(clipTs)} to inspect your loudest snare/kick hits.`,
      what_to_try: "Lower your final limiter output ceiling to -1.0 dBTP (with 4x oversampling/ISP detection enabled).",
      recheck_target: "Confirm True Peak measures between -1.2 and -1.0 dBTP.",
    });
  }

  // 2. Stereo Phase Correlation & Sub-Bass (<120 Hz) Phase
  const [pStart, pEnd] = stereo.worstPhaseWindow;
  const fmtCorr = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

  if (stereo.phaseCorrelationAvg < 0.0) {
    findings.push({
      evidence_id: "ev_phase_01",
      category: "stereo_phase",
      severity: "alert",
      classification: "objective_defect",
      confidence: "measured",
      title: `Severe Stereo Phase Cancellation (${fmtCorr(stereo.phaseCorrelationAvg)})`,
      timestamp_start_sec: pStart,
      timestamp_end_sec: pEnd,
      measured_value: `Correlation ${fmtCorr(stereo.phaseCorrelationAvg)}, Stereo width ${stereo.stereoWidthRatio.toFixed(2)}`,
      what_happened: `Average L/R phase correlation is negative (${fmtCorr(stereo.phaseCorrelationAvg)}), dropping sharpest near ${fmtTime(pStart)}.`,
      why_it_matters: "When summed to mono (phones, club PAs, smart speakers), opposite-polarity L/R signals cancel each other out and collapse in level.",
      listen_prompt: `Jump to ${fmtTime(pStart)} and switch Stereo Mode from Stereo to Mono Fold (0.5L + 0.5R) to hear elements hollow out or vanish.`,
      what_to_try: "Check stereo wideners, Haas delays, or inverted track polarity switches; collapse sub frequencies (< 120 Hz) to mono.",
      recheck_target: "Re-export and verify average correlation moves safely above +0.35 (and sub-bass stays near +1.0).",
    });
  } else if (
    stereo.phaseCorrelationAvg < 0.35 ||
    (stereo.phaseCorrelationSeries.length > 0 && Math.min(...stereo.phaseCorrelationSeries) < 0.1)
  ) {
    const minCorr =
      stereo.phaseCorrelationSeries.length > 0
        ? Math.min(...stereo.phaseCorrelationSeries)
        : stereo.phaseCorrelationAvg;
    findings.push({
      evidence_id: "ev_phase_01",
      category: "stereo_phase",
      severity: "caution",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Mono Compatibility Risk in Wide Section (${fmtCorr(minCorr)})`,
      timestamp_start_sec: pStart,
      timestamp_end_sec: pEnd,
      measured_value: `Min correlation ${fmtCorr(minCorr)} (Avg ${fmtCorr(stereo.phaseCorrelationAvg)})`,
      what_happened:
        `Stereo correlation dips to ${fmtCorr(minCorr)} around ${fmtTime(pStart)}` +
        (vision.has("wide") ? " while pursuing your Wide vision profile." : "."),
      why_it_matters: "Excessive side energy (< +0.2 correlation) loses body and punch when played on mono phone speakers or summed club systems.",
      listen_prompt: `Toggle Stereo vs. Mono Fold around ${fmtTime(pStart)} to judge whether lead or synth layers lose presence.`,
      what_to_try: "Use mid/side EQ to high-pass Side energy below 150 Hz and slightly dial back stereo chorus/Haas width on main hooks.",
      recheck_target: "Target minimum 1-second phase correlation >= +0.25 while keeping your wide feel in stereo.",
    });
  }

  if (stereo.lowEndPhaseCorrelation < 0.30) {
    findings.push({
      evidence_id: "ev_phase_low_01",
      category: "stereo_phase",
      severity: stereo.lowEndPhaseCorrelation < 0.0 ? "alert" : "caution",
      classification: "objective_defect",
      confidence: "measured",
      band_name: "sub",
      title: `Wide / Uncentered Sub-Bass Below 120 Hz (${fmtCorr(stereo.lowEndPhaseCorrelation)})`,
      timestamp_start_sec: pStart,
      timestamp_end_sec: pEnd,
      measured_value: `20-120 Hz correlation ${fmtCorr(stereo.lowEndPhaseCorrelation)} (recommended >= +0.70)`,
      what_happened: `4th-order Butterworth 20-120 Hz bandpass correlation measures ${fmtCorr(stereo.lowEndPhaseCorrelation)}, indicating significant Side energy in the low end.`,
      why_it_matters: "Stereo sub-bass suffers heavy cancellation in mono playback (club PAs, phone speakers) and wastes headroom on vinyl or streaming masters.",
      listen_prompt: `Switch Stereo Mode to Mono Fold around ${fmtTime(pStart)} and listen to kick/sub weight drop or hollow out.`,
      what_to_try: "Insert a Mid/Side EQ on your master or bass bus and high-pass the Side channel at 100–130 Hz so sub frequencies sum cleanly in mono.",
      recheck_target: "Confirm 20-120 Hz phase correlation climbs above +0.70.",
    });
  }

  // 3. Spectral Tonal Balance Findings
  const bandCandidates: Array<[number, SpectralBand]> = [];
  for (const sb of spectral.bands) {
    const threshold = ["low", "low_mid", "high_mid"].includes(sb.band) ? 2.2 : 2.8;
    if (Math.abs(sb.delta_vs_genre_median_db) >= threshold) {
      bandCandidates.push([Math.abs(sb.delta_vs_genre_median_db), sb]);
    }
  }
  bandCandidates.sort((a, b) => b[0] - a[0]);

  for (const [, sb] of bandCandidates.slice(0, 3)) {
    const [label, hzText] = BAND_LABELS[sb.band];
    const [wStart, wEnd] = spectral.bandPeakWindows[sb.band] ?? [loudStart, loudEnd];
    const delta = sb.delta_vs_genre_median_db;
    const fmtDelta = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
    const direction = delta > 0 ? "Excess" : "Recessed";
    const severity = Math.abs(delta) >= 5.0 ? "alert" : "caution";

    let title: string;
    let why: string;
    let listen: string;
    let tryHint: string;
    let recheck: string;

    if ((sb.band === "sub" || sb.band === "low") && delta > 0) {
      title = `${label} Buildup Around ${hzText}`;
      why = "Excess low-end energy eats headroom early on limiters and causes boomy, muddy kick/bass blur on small speakers.";
      listen = `Jump to ${fmtTime(wStart)} and switch between Full Range, Laptop, and Smartphone previews to hear if low notes mask the midrange.`;
      tryHint =
        sb.band === "low"
          ? "Check high-pass filters on non-bass instruments around 100-140 Hz, or apply a gentle 1.5-3.0 dB dynamic EQ cut near 120-180 Hz."
          : "Trim sub-45 Hz rumble on non-sub tracks and verify kick/sub phase alignment below 60 Hz.";
      recheck = `Re-export and check ${hzText} relative delta settles within +/-1.8 dB of your ${context.genre} median.`;
    } else if (sb.band === "low_mid" && delta > 0) {
      title = `Boxy Low-Mid Congestion (${hzText})`;
      why = "Energy piling up between 250 and 800 Hz clouds vocal clarity and creates a cardboard-like resonance on laptops.";
      listen = `Audition ${fmtTime(wStart)} on the Laptop translation profile to hear whether chords and snare body crowd the center.`;
      tryHint = "Sweep gently between 300 and 550 Hz on congested synth/guitar buses with a 1.5-2.5 dB wide-Q cut.";
      recheck = `Verify ${hzText} delta drops within +/-1.8 dB without thinning out warmth.`;
    } else if (sb.band === "high_mid" && delta > 0) {
      title = `Forward Upper-Mids / Harshness Risk (${hzText})`;
      why = "Excess 800 Hz - 4 kHz energy causes rapid ear fatigue and turns shrill on smartphone speakers.";
      listen = `Switch to the Smartphone preview at ${fmtTime(wStart)}—if vocals or leads pierce uncomfortably, tame this pocket.`;
      tryHint = "Try a dynamic EQ dip of 1.5-2.5 dB around 2.2-3.5 kHz triggered only on loud vocal/synth peaks.";
      recheck = `Confirm ${hzText} delta moves within +/-2.0 dB.`;
    } else if ((sb.band === "presence" || sb.band === "air") && delta < 0) {
      const warmNote = vision.has("warm")
        ? " (consistent with a Warm profile, though worth checking clarity)"
        : "";
      title = `Dark / Recessed ${label} (${hzText})${warmNote}`;
      why = "Under-represented upper frequencies can make a mix sound veiled behind a blanket next to commercial releases.";
      listen = `A/B against a loudness-matched reference track around ${fmtTime(wStart)} and check hi-hat/vocal air.`;
      tryHint = "Add a gentle +1.0 to +2.0 dB high shelf above 6-10 kHz on vocals/overheads, or parallel bright exciter.";
      recheck = `Verify ${hzText} balance sits within +/-2.2 dB of your genre reference envelope.`;
    } else {
      title = `${label} ${direction} (${hzText}: ${fmtDelta} dB)`;
      why = `A ${Math.abs(delta).toFixed(1)} dB departure from typical ${context.genre} spectral tilt shifts perceived tonal weight across playback systems.`;
      listen = `Loop ${fmtTime(wStart)} and toggle Laptop and Smartphone previews to check translation.`;
      tryHint =
        delta > 0
          ? `Apply a broad 1.5-2.5 dB trim in ${hzText} on the dominant group bus.`
          : `Check whether ${hzText} was over-attenuated by heavy low/high-pass filtering and restore 1-2 dB smoothly.`;
      recheck = `Target ${hzText} delta within +/-2.0 dB of the genre profile.`;
    }

    findings.push({
      evidence_id: `ev_tonal_${sb.band}_01`,
      category: "tonal_balance",
      severity,
      classification: "stylistic_choice",
      confidence: "measured",
      band_name: sb.band,
      title,
      timestamp_start_sec: wStart,
      timestamp_end_sec: wEnd,
      measured_value: `${fmtDelta} dB vs ${context.genre} median (${sb.energy_db.toFixed(1)} dB band energy)`,
      what_happened: `Energy in ${hzText} measures ${fmtDelta} dB relative to typical ${context.genre} balance, peaking near ${fmtTime(wStart)}.`,
      why_it_matters: why,
      listen_prompt: listen,
      what_to_try: tryHint,
      recheck_target: recheck,
    });
  }

  // 4. Loudness & Dynamics Context
  const [targetLow, targetHigh] = GENRE_MASTER_LOUDNESS_RANGE[context.genre] ?? [-14.0, -9.0];
  if (context.stage === "unmastered_mix" && loudness.integratedLufs > -11.5) {
    findings.push({
      evidence_id: "ev_loudness_01",
      category: "loudness",
      severity: "caution",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Unmastered Mix Already Loud (${loudness.integratedLufs.toFixed(1)} LUFS)`,
      timestamp_start_sec: loudStart,
      timestamp_end_sec: loudEnd,
      measured_value: `${loudness.integratedLufs.toFixed(1)} LUFS (typical unmastered: -22 to -14 LUFS)`,
      what_happened: `Integrated loudness is ${loudness.integratedLufs.toFixed(1)} LUFS despite being tagged as an Unmastered Mix.`,
      why_it_matters: "Heavy mix-bus limiting before mastering locks in distortion and prevents a clean mastering stage.",
      listen_prompt: `Audition ${fmtTime(loudStart)} and compare transient snap against a loudness-matched reference.`,
      what_to_try: "Bypass any temporary master limiter used for loudness previewing and aim for -18 to -14 LUFS on the pre-master bounce.",
      recheck_target: "Verify integrated loudness moves into -20 to -14 LUFS with >= 3.0 dBTP headroom.",
    });
  } else if (context.stage === "final_master" && loudness.integratedLufs < targetLow - 2.0) {
    findings.push({
      evidence_id: "ev_loudness_01",
      category: "loudness",
      severity: "caution",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Conservative Master Loudness (${loudness.integratedLufs.toFixed(1)} LUFS)`,
      timestamp_start_sec: loudStart,
      timestamp_end_sec: loudEnd,
      measured_value: `${loudness.integratedLufs.toFixed(1)} LUFS (typical ${context.genre}: ${targetLow.toFixed(0)} to ${targetHigh.toFixed(0)} LUFS)`,
      what_happened: `Your final master measures ${loudness.integratedLufs.toFixed(1)} LUFS, quieter than most ${context.genre} releases (though streaming platforms normalize upward/downward).`,
      why_it_matters: "Spotify Normal (-14 LUFS) will add upward gain; if True Peak is already near -1.0 dBTP, client limiting could engage.",
      listen_prompt: `Check Streaming Normalization estimates and audition ${fmtTime(loudStart)}.`,
      what_to_try: "If intentional for a Dynamic profile, keep it! Otherwise gently drive 1-2 dB into a transparent limiter with -1.0 dBTP ceiling.",
      recheck_target: "Confirm integrated loudness and Spotify Normal gain stay free of client limiter engagement.",
    });
  }

  if (dynamics.psrDb > 0 && (dynamics.psrDb < 6.0 || dynamics.crestFactorDb < 7.0)) {
    const visionNote = vision.has("aggressive")
      ? " This aligns with your Aggressive profile, though extreme density still carries streaming translation risks."
      : " If you selected a Dynamic or Punchy goal, transient punch may be over-compressed.";
    findings.push({
      evidence_id: "ev_dynamics_01",
      category: "dynamics",
      severity: "caution",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Compressed Transient Density (PSR ${dynamics.psrDb.toFixed(1)} dB)`,
      timestamp_start_sec: loudStart,
      timestamp_end_sec: loudEnd,
      measured_value: `PSR ${dynamics.psrDb.toFixed(1)} dB, Crest Factor ${dynamics.crestFactorDb.toFixed(1)} dB`,
      what_happened: `Peak-to-Short-Term Loudness Ratio measures ${dynamics.psrDb.toFixed(1)} dB during the loudest section.${visionNote}`,
      why_it_matters: "When PSR drops below 6 dB, kick and snare transients flatten out, making drops feel smaller after streaming loudness matching.",
      listen_prompt: `Level-match a reference track at ${fmtTime(loudStart)} and listen specifically to snare attack and vocal breath.`,
      what_to_try: "Back off master limiter threshold by 1-2 dB or lengthen drum bus compressor attack (15-30 ms) so transients punch through.",
      recheck_target: "Re-export and aim for PSR >= 7.0 dB and Crest Factor >= 8.5 dB.",
    });
  }

  if (
    dynamics.transientPunchDb > 0 &&
    dynamics.transientPunchDb < 4.5 &&
    (dynamics.psrDb < 8.5 || dynamics.crestFactorDb < 10.0)
  ) {
    const punchSev = dynamics.transientPunchDb < 3.0 ? "alert" : "caution";
    findings.push({
      evidence_id: "ev_transient_crush_01",
      category: "dynamics",
      severity: punchSev,
      classification: punchSev === "alert" ? "objective_defect" : "stylistic_choice",
      confidence: "measured",
      title: `Over-Limited / Crushed Transients (${dynamics.transientPunchDb.toFixed(1)} dB punch)`,
      timestamp_start_sec: loudStart,
      timestamp_end_sec: loudEnd,
      measured_value: `Transient punch ${dynamics.transientPunchDb.toFixed(1)} dB (10 ms attack vs 200 ms body RMS)`,
      what_happened: `Short-term 10 ms attack energy sits only ${dynamics.transientPunchDb.toFixed(1)} dB above the 200 ms body RMS near ${fmtTime(loudStart)}, indicating heavy transient shaving.`,
      why_it_matters:
        "Over-limiting shaves kick and snare impact, causing listener fatigue and making the mix sound smaller than punchier releases once streaming loudness-matches playback.",
      listen_prompt: `Audition ${fmtTime(loudStart)} and compare drum snap against a loudness-matched reference track.`,
      what_to_try:
        "Pull back final limiter input drive by 1.5–2.5 dB, slow drum bus compressor attack to 20–30 ms, or use a gentle soft clipper before limiting.",
      recheck_target:
        "Re-export and verify Transient Punch climbs above 5.0 dB without sacrificing perceived impact.",
    });
  }

  // 5. Baseline safe confirmations
  if (!findings.some((f) => f.category === "true_peak")) {
    findings.push({
      evidence_id: "ev_true_peak_safe_01",
      category: "true_peak",
      severity: "safe",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Healthy Peak Headroom (${fmtTp(peaks.truePeakDbtp)} dBTP)`,
      timestamp_start_sec: loudStart,
      timestamp_end_sec: loudEnd,
      measured_value: `${fmtTp(peaks.truePeakDbtp)} dBTP (Sample peak ${fmtTp(peaks.samplePeakDbfs)} dBFS)`,
      what_happened: `4x oversampled True Peak stays cleanly below ceiling at ${fmtTp(peaks.truePeakDbtp)} dBTP.`,
      why_it_matters: "Safe true-peak headroom protects your transients during AAC/MP3 streaming transcodes and mastering processing.",
      listen_prompt: `Audition ${fmtTime(loudStart)} to confirm clean transient clarity with zero digital clipping.`,
      what_to_try: "No peak reduction needed—keep your current ceiling discipline as you refine tonal balance.",
      recheck_target: "Maintain True Peak <= -1.0 dBTP (final master) or <= -3.0 dBTP (unmastered mix).",
    });
  }

  if (!findings.some((f) => f.category === "stereo_phase")) {
    findings.push({
      evidence_id: "ev_phase_safe_01",
      category: "stereo_phase",
      severity: "safe",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Solid Mono Phase Translation (${fmtCorr(stereo.phaseCorrelationAvg)})`,
      timestamp_start_sec: loudStart,
      timestamp_end_sec: loudEnd,
      measured_value: `Avg correlation ${fmtCorr(stereo.phaseCorrelationAvg)}, Sub <120Hz ${fmtCorr(stereo.lowEndPhaseCorrelation)}, Width ${stereo.stereoWidthRatio.toFixed(2)}`,
      what_happened: `L/R phase correlation averages ${fmtCorr(stereo.phaseCorrelationAvg)} (sub-120 Hz ${fmtCorr(stereo.lowEndPhaseCorrelation)}) with healthy Mid/Side balance.`,
      why_it_matters: "Positive correlation ensures your mix holds together without hollowing out on mono phone speakers or club PAs.",
      listen_prompt: `Toggle Stereo and Mono Fold around ${fmtTime(loudStart)} to verify snare and bass weight stay locked.`,
      what_to_try: "Preserve this stereo foundation if you add spatial effects later—keep sub-bass mono below 120 Hz.",
      recheck_target: "Keep average correlation above +0.40 after final tweaks.",
    });
  }

  if (findings.length < 3) {
    findings.push({
      evidence_id: "ev_dynamics_safe_01",
      category: "dynamics",
      severity: "safe",
      classification: "stylistic_choice",
      confidence: "measured",
      title: `Balanced Dynamic Contrast (PSR ${dynamics.psrDb.toFixed(1)} dB)`,
      timestamp_start_sec: loudStart,
      timestamp_end_sec: loudEnd,
      measured_value: `PSR ${dynamics.psrDb.toFixed(1)} dB, LRA ${loudness.loudnessRangeLu.toFixed(1)} LU`,
      what_happened: `Crest factor (${dynamics.crestFactorDb.toFixed(1)} dB) and PSR (${dynamics.psrDb.toFixed(1)} dB) preserve clear rhythmic punch.`,
      why_it_matters: "Healthy transient-to-body ratio keeps mixes exciting at both quiet and loud playback volumes.",
      listen_prompt: `Listen across ${fmtTime(loudStart)} with Device Lab toggled between Full Range and Smartphone.`,
      what_to_try: "Use a loudness-matched reference track in Advanced Mode to verify macro energy arc between verse and drop.",
      recheck_target: "Maintain PSR >= 7.0 dB across revisions.",
    });
  }

  const rank: Record<string, number> = { alert: 0, caution: 1, safe: 2 };
  findings.sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
  return findings;
}
