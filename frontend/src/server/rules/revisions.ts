import type {
  AnalysisReport,
  Finding,
  RevisionComparison,
  RevisionFindingStatus,
  RevisionMetricDeltas,
} from "@/types/report";

const SEVERITY_SCORE: Record<string, number> = { safe: 0, caution: 1, alert: 2 };

export function compareRevisions(
  baseline: AnalysisReport,
  revised: AnalysisReport
): RevisionComparison {
  const bm = baseline.global_metrics;
  const rm = revised.global_metrics;

  const bBands = Object.fromEntries(baseline.spectral_bands.map((b) => [b.band, b.energy_db]));
  const rBands = Object.fromEntries(revised.spectral_bands.map((b) => [b.band, b.energy_db]));
  const bandDeltas: Record<string, number> = {};
  for (const [band, energy] of Object.entries(bBands)) {
    bandDeltas[band] = Math.round(((rBands[band] ?? -70.0) - energy) * 100) / 100;
  }

  const metricDeltas: RevisionMetricDeltas = {
    integrated_lufs_delta: Math.round((rm.integrated_lufs - bm.integrated_lufs) * 100) / 100,
    true_peak_dbtp_delta: Math.round((rm.true_peak_dbtp - bm.true_peak_dbtp) * 100) / 100,
    loudness_range_lu_delta: Math.round((rm.loudness_range_lu - bm.loudness_range_lu) * 100) / 100,
    crest_factor_db_delta: Math.round((rm.crest_factor_db - bm.crest_factor_db) * 100) / 100,
    plr_db_delta:
      Math.round(
        ((rm.plr_db ?? Math.max(0, rm.true_peak_dbtp - rm.integrated_lufs)) -
          (bm.plr_db ?? Math.max(0, bm.true_peak_dbtp - bm.integrated_lufs))) *
          100
      ) / 100,
    psr_db_delta: Math.round((rm.psr_db - bm.psr_db) * 100) / 100,
    phase_correlation_delta:
      Math.round((rm.phase_correlation_avg - bm.phase_correlation_avg) * 1000) / 1000,
    band_deltas_db: bandDeltas,
  };

  const revisedById = new Map<string, Finding>(revised.findings.map((f) => [f.evidence_id, f]));
  const revisedByCat = new Map<string, Finding>();
  for (const f of revised.findings) {
    if (f.category !== "tonal_balance" && !revisedByCat.has(f.category)) {
      revisedByCat.set(f.category, f);
    }
  }

  const statuses: RevisionFindingStatus[] = [];
  const fmtSigned = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

  for (const bf of baseline.findings) {
    const rf =
      revisedById.get(bf.evidence_id) ??
      (bf.category !== "tonal_balance" ? revisedByCat.get(bf.category) : undefined);

    if (bf.severity === "safe" && rf && rf.severity === "safe") {
      let st: RevisionFindingStatus["status"] = "unchanged";
      let msg = "Remained within target range in v2.";
      if (bf.category === "true_peak" && rm.true_peak_dbtp < bm.true_peak_dbtp - 0.5) {
        st = "improved";
        msg = `Headroom expanded further by ${(bm.true_peak_dbtp - rm.true_peak_dbtp).toFixed(2)} dBTP.`;
      } else if (bf.category === "stereo_phase" && rm.phase_correlation_avg > bm.phase_correlation_avg + 0.08) {
        st = "improved";
        msg = `Phase correlation strengthened by +${(rm.phase_correlation_avg - bm.phase_correlation_avg).toFixed(2)}.`;
      } else if (bf.category === "dynamics" && rm.psr_db > bm.psr_db + 0.6) {
        st = "improved";
        msg = `Transient dynamic PSR improved by +${(rm.psr_db - bm.psr_db).toFixed(1)} dB.`;
      }
      statuses.push({
        evidence_id: bf.evidence_id,
        title: bf.title,
        category: bf.category,
        status: st,
        baseline_value: bf.measured_value,
        revised_value: rf.measured_value,
        summary: msg,
      });
      continue;
    }

    if (!rf) {
      statuses.push({
        evidence_id: bf.evidence_id,
        title: bf.title,
        category: bf.category,
        status: "improved",
        baseline_value: bf.measured_value,
        revised_value: "Within target range in v2",
        summary: `Resolved: '${bf.title}' no longer exceeds threshold in the revised mix.`,
      });
      continue;
    }

    const bScore = SEVERITY_SCORE[bf.severity] ?? 0;
    const rScore = SEVERITY_SCORE[rf.severity] ?? 0;
    let status: RevisionFindingStatus["status"];
    let summary: string;

    if (rScore < bScore) {
      status = "improved";
      summary = `Severity reduced from ${bf.severity} to ${rf.severity}.`;
    } else if (rScore > bScore) {
      status = "regressed";
      summary = `Severity increased from ${bf.severity} to ${rf.severity}.`;
    } else if (bf.category === "true_peak") {
      if (rm.true_peak_dbtp < bm.true_peak_dbtp - 0.3) {
        status = "improved";
        summary = `Headroom improved by ${(bm.true_peak_dbtp - rm.true_peak_dbtp).toFixed(2)} dBTP.`;
      } else if (rm.true_peak_dbtp > bm.true_peak_dbtp + 0.3) {
        status = "regressed";
        summary = `Headroom tightened by ${fmtSigned(rm.true_peak_dbtp - bm.true_peak_dbtp)} dBTP.`;
      } else {
        status = "unchanged";
        summary = "True Peak stayed within +/-0.3 dBTP of v1.";
      }
    } else if (bf.category === "stereo_phase") {
      if (rm.phase_correlation_avg > bm.phase_correlation_avg + 0.05) {
        status = "improved";
        summary = `Phase correlation improved from ${fmtSigned(bm.phase_correlation_avg)} to ${fmtSigned(rm.phase_correlation_avg)}.`;
      } else if (rm.phase_correlation_avg < bm.phase_correlation_avg - 0.05) {
        status = "regressed";
        summary = `Phase correlation dropped from ${fmtSigned(bm.phase_correlation_avg)} to ${fmtSigned(rm.phase_correlation_avg)}.`;
      } else {
        status = "unchanged";
        summary = "Phase correlation stayed within +/-0.05 of v1.";
      }
    } else if (bf.category === "dynamics") {
      if (rm.psr_db > bm.psr_db + 0.5) {
        status = "improved";
        summary = `Dynamic headroom (PSR) rose from ${bm.psr_db.toFixed(1)} dB to ${rm.psr_db.toFixed(1)} dB.`;
      } else if (rm.psr_db < bm.psr_db - 0.5) {
        status = "regressed";
        summary = `Dynamic headroom (PSR) dropped from ${bm.psr_db.toFixed(1)} dB to ${rm.psr_db.toFixed(1)} dB.`;
      } else {
        status = "unchanged";
        summary = "Dynamics stayed within +/-0.5 dB PSR of v1.";
      }
    } else if (bf.category === "loudness") {
      const stage = revised.context.stage;
      const targetRef = stage === "unmastered_mix" ? -16.0 : -11.0;
      const bDist = Math.abs(bm.integrated_lufs - targetRef);
      const rDist = Math.abs(rm.integrated_lufs - targetRef);
      if (rDist < bDist - 0.5) {
        status = "improved";
        summary = `Integrated loudness moved closer to ${stage.replace(/_/g, " ")} range (${rm.integrated_lufs.toFixed(1)} LUFS).`;
      } else if (rDist > bDist + 0.5) {
        status = "regressed";
        summary = `Integrated loudness drifted further from target (${rm.integrated_lufs.toFixed(1)} LUFS).`;
      } else {
        status = "unchanged";
        summary = "Integrated loudness stayed within +/-0.5 LU of v1.";
      }
    } else if (bf.category === "tonal_balance") {
      const bandKey =
        bf.band_name ?? bf.evidence_id.replace("ev_tonal_", "").replace("_01", "");
      const bBand = baseline.spectral_bands.find((b) => b.band === bandKey);
      const rBand = revised.spectral_bands.find((b) => b.band === bandKey);
      const bD = bBand ? Math.abs(bBand.delta_vs_genre_median_db) : null;
      const rD = rBand ? Math.abs(rBand.delta_vs_genre_median_db) : null;
      if (bD !== null && rD !== null && rD < bD - 0.5) {
        status = "improved";
        summary = `Band deviation narrowed from ${bD.toFixed(1)} dB to ${rD.toFixed(1)} dB.`;
      } else if (bD !== null && rD !== null && rD > bD + 0.5) {
        status = "regressed";
        summary = `Band deviation widened from ${bD.toFixed(1)} dB to ${rD.toFixed(1)} dB.`;
      } else {
        status = "unchanged";
        summary = "Measurement stayed within +/-0.5 dB of v1.";
      }
    } else {
      status = "unchanged";
      summary = "Metric remained in the same diagnostic tier.";
    }

    statuses.push({
      evidence_id: bf.evidence_id,
      title: bf.title,
      category: bf.category,
      status,
      baseline_value: bf.measured_value,
      revised_value: rf.measured_value,
      summary,
    });
  }

  const bandByEid = new Map<string, string>();
  for (const f of baseline.findings) {
    if (f.category === "tonal_balance") {
      bandByEid.set(
        f.evidence_id,
        f.band_name ?? f.evidence_id.replace("ev_tonal_", "").replace("_01", "")
      );
    }
  }
  const trackedTonal = new Set(
    statuses
      .filter((s) => s.category === "tonal_balance")
      .map(
        (s) =>
          bandByEid.get(s.evidence_id) ??
          s.evidence_id.replace("ev_tonal_", "").replace("_01", "")
      )
  );

  for (const rb of revised.spectral_bands) {
    if (trackedTonal.has(rb.band)) continue;
    const bb = baseline.spectral_bands.find((b) => b.band === rb.band);
    if (!bb) continue;
    const bAbs = Math.abs(bb.delta_vs_genre_median_db);
    const rAbs = Math.abs(rb.delta_vs_genre_median_db);
    if (bAbs - rAbs >= 1.2) {
      statuses.push({
        evidence_id: `ev_tonal_${rb.band}_01`,
        title: `Spectral Balance (${rb.range_hz} Hz)`,
        category: "tonal_balance",
        status: "improved",
        baseline_value: `${fmtSigned(bb.delta_vs_genre_median_db, 1)} dB vs median`,
        revised_value: `${fmtSigned(rb.delta_vs_genre_median_db, 1)} dB vs median`,
        summary: `${rb.range_hz} Hz tilt moved closer to genre median (${bAbs.toFixed(1)} dB -> ${rAbs.toFixed(1)} dB).`,
      });
    } else if (rAbs - bAbs >= 1.5 && rAbs >= 2.5) {
      statuses.push({
        evidence_id: `ev_tonal_${rb.band}_01`,
        title: `Spectral Balance (${rb.range_hz} Hz)`,
        category: "tonal_balance",
        status: "regressed",
        baseline_value: `${fmtSigned(bb.delta_vs_genre_median_db, 1)} dB vs median`,
        revised_value: `${fmtSigned(rb.delta_vs_genre_median_db, 1)} dB vs median`,
        summary: `${rb.range_hz} Hz moved away from genre median (${bAbs.toFixed(1)} dB -> ${rAbs.toFixed(1)} dB).`,
      });
    }
  }

  const baselineIds = new Set(baseline.findings.map((bf) => bf.evidence_id));
  for (const rf of revised.findings) {
    if (!baselineIds.has(rf.evidence_id) && rf.severity !== "safe") {
      statuses.push({
        evidence_id: rf.evidence_id,
        title: rf.title,
        category: rf.category,
        status: "regressed",
        baseline_value: "Not flagged in v1",
        revised_value: rf.measured_value,
        summary: `New issue introduced in v2: ${rf.title}.`,
      });
    }
  }

  return {
    baseline_report_id: baseline.report_id,
    revised_report_id: revised.report_id,
    baseline_filename: baseline.audio_metadata.filename,
    revised_filename: revised.audio_metadata.filename,
    revised_playback_proxy_url: revised.audio_metadata.playback_proxy_url,
    metric_deltas: metricDeltas,
    finding_statuses: statuses,
  };
}
