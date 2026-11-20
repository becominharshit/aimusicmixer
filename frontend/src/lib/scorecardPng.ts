import type { AnalysisReport } from "@/types/report";

export const SCORECARD_WIDTH = 1200;
export const SCORECARD_HEIGHT = 630;

function formatSigned(val: number, decimals = 1): string {
  const safe = Number.isFinite(val) ? val : 0;
  return `${safe >= 0 ? "+" : ""}${safe.toFixed(decimals)}`;
}

function truncateText(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Draws the geometric MIXIT vinyl + EQ emblem onto a 2D canvas context.
 */
function drawMixitMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.fillStyle = "#14171F";
  ctx.fillRect(x, y, size, size);

  const pad = size * 0.1;
  const inner = size - pad * 2;
  const half = inner * 0.5;

  // Left half: vinyl grooves (Warm Marigold + Studio Coral corners)
  ctx.fillStyle = "#E85D4A";
  ctx.fillRect(x + pad, y + pad, half, inner);

  ctx.fillStyle = "#F5C451";
  ctx.beginPath();
  ctx.arc(x + pad + half, y + pad + half, half * 0.92, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill();

  ctx.fillStyle = "#14171F";
  ctx.beginPath();
  ctx.arc(x + pad + half, y + pad + half, half * 0.36, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#E85D4A";
  ctx.beginPath();
  ctx.arc(x + pad + half, y + pad + half, half * 0.14, 0, Math.PI * 2);
  ctx.fill();

  // Right half: 3 vertical EQ bars
  const barX = x + pad + half + size * 0.04;
  const barW = (half - size * 0.08) / 3;
  const bars = [
    { h: 0.9, color: "#E85D4A" },
    { h: 0.62, color: "#F5C451" },
    { h: 0.78, color: "#38D39F" },
  ];
  bars.forEach((b, i) => {
    const bx = barX + i * (barW + size * 0.02);
    const bh = inner * b.h;
    ctx.fillStyle = b.color;
    ctx.fillRect(bx, y + pad + (inner - bh), barW, bh);
  });

  ctx.restore();
}

/**
 * Renders a crisp 1200x630 Swiss Neo-Brutalist Mixit Proof Scorecard onto a canvas.
 * Includes MIXIT. mark, track telemetry (LUFS, 4x True Peak, 20-120 Hz Sub Phase, PLR/LRA),
 * and v1 → v2 improvement deltas when a revision comparison is present.
 */
export function renderScorecardToCanvas(
  canvas: HTMLCanvasElement,
  report: AnalysisReport
): void {
  canvas.width = SCORECARD_WIDTH;
  canvas.height = SCORECARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = SCORECARD_WIDTH;
  const H = SCORECARD_HEIGHT;
  const m = report.global_metrics;
  const comp = report.revision_comparison;
  const subPhase = m.low_end_phase_correlation ?? m.phase_correlation_avg;
  const plr = m.plr_db ?? Math.max(0, m.true_peak_dbtp - m.integrated_lufs);

  // 1. Crisp Warm Ivory Canvas + 3px Deep Slate Outer Frame
  ctx.fillStyle = "#F9F8F4";
  ctx.fillRect(0, 0, W, H);

  const M = 28;
  const innerW = W - M * 2;
  const innerH = H - M * 2;
  ctx.strokeStyle = "#14171F";
  ctx.lineWidth = 3;
  ctx.strokeRect(M, M, innerW, innerH);

  // 2. Top Header Strip (height 84px)
  const headerH = 84;
  ctx.beginPath();
  ctx.moveTo(M, M + headerH);
  ctx.lineTo(M + innerW, M + headerH);
  ctx.stroke();

  // Brand lockup left
  drawMixitMark(ctx, M + 20, M + 18, 48);
  ctx.fillStyle = "#14171F";
  ctx.font = "900 38px 'Arial Black', Impact, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("MIXIT.", M + 80, M + 44);

  // Center separator + descriptor
  ctx.beginPath();
  ctx.moveTo(M + 260, M);
  ctx.lineTo(M + 260, M + headerH);
  ctx.stroke();

  ctx.fillStyle = "#14171F";
  ctx.font = "700 13px 'JetBrains Mono', monospace";
  ctx.fillText("DETERMINISTIC DSP PROOF SCORECARD", M + 284, M + 32);
  ctx.fillStyle = "#475467";
  ctx.font = "600 13px 'JetBrains Mono', monospace";
  const srKhz = (report.audio_metadata.sample_rate_hz / 1000).toFixed(1);
  const bpmTag = report.audio_metadata.bpm ? ` · ${Math.round(report.audio_metadata.bpm)} BPM` : "";
  ctx.fillText(
    `${report.context.genre.replace(/_/g, " ").toUpperCase()} · ${report.context.stage.replace(/_/g, " ").toUpperCase()} · ${srKhz} KHZ${bpmTag}`,
    M + 284,
    M + 56
  );

  // Top-right Warm Marigold Status Badge
  const badgeW = 240;
  ctx.fillStyle = comp ? "#F5C451" : "#14171F";
  ctx.fillRect(M + innerW - badgeW, M, badgeW, headerH);
  ctx.beginPath();
  ctx.moveTo(M + innerW - badgeW, M);
  ctx.lineTo(M + innerW - badgeW, M + headerH);
  ctx.stroke();

  ctx.fillStyle = comp ? "#14171F" : "#F0B44C";
  ctx.font = "800 15px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    comp ? "V1 → V2 VERIFIED" : "DSP MEASURED",
    M + innerW - badgeW / 2,
    M + 34
  );
  ctx.font = "700 12px 'JetBrains Mono', monospace";
  ctx.fillStyle = comp ? "#14171F" : "#F2F0EA";
  ctx.fillText(
    `${report.findings.filter((f) => f.severity === "alert").length} ALERTS · ${report.findings.length} FINDINGS`,
    M + innerW - badgeW / 2,
    M + 56
  );
  ctx.textAlign = "left";

  // 3. Track Title Banner (height 86px)
  const titleTop = M + headerH;
  const titleH = 86;
  ctx.beginPath();
  ctx.moveTo(M, titleTop + titleH);
  ctx.lineTo(M + innerW, titleTop + titleH);
  ctx.stroke();

  ctx.fillStyle = "#475467";
  ctx.font = "700 11px 'JetBrains Mono', monospace";
  ctx.fillText(comp ? "REVISION COMPARISON" : "ANALYZED STEREO TRACK", M + 24, titleTop + 26);

  ctx.fillStyle = "#14171F";
  ctx.font = "800 30px 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif";
  const displayTitle = comp
    ? `${truncateText(comp.baseline_filename, 26)}  →  ${truncateText(comp.revised_filename, 26)}`
    : truncateText(report.audio_metadata.filename, 52);
  ctx.fillText(displayTitle, M + 24, titleTop + 58);

  // 4. 4-Column Charcoal-Obsidian Telemetry Grid (height 168px)
  const metricsTop = titleTop + titleH;
  const metricsH = 168;
  ctx.fillStyle = "#0E1117";
  ctx.fillRect(M, metricsTop, innerW, metricsH);

  const colW = innerW / 4;
  const metricCells = [
    {
      label: "INTEGRATED LOUDNESS",
      value: `${m.integrated_lufs.toFixed(1)}`,
      unit: "LUFS",
      sub: `LRA ${m.loudness_range_lu.toFixed(1)} LU · ST Max ${m.short_term_max_lufs.toFixed(1)}`,
      color: "#F2F0EA",
      delta: comp ? `${formatSigned(comp.metric_deltas.integrated_lufs_delta, 1)} LU` : null,
    },
    {
      label: "4X TRUE PEAK",
      value: `${formatSigned(m.true_peak_dbtp, 2)}`,
      unit: "dBTP",
      sub: `Sample Peak ${formatSigned(m.sample_peak_dbfs, 2)} dBFS`,
      color: m.true_peak_dbtp > -0.1 ? "#EF6B63" : m.true_peak_dbtp <= -1.0 ? "#38D39F" : "#F0B44C",
      delta: comp ? `${formatSigned(comp.metric_deltas.true_peak_dbtp_delta, 2)} dBTP` : null,
    },
    {
      label: "20–120 HZ SUB PHASE",
      value: `${formatSigned(subPhase, 2)}`,
      unit: "CORR",
      sub: `Full-Band ${formatSigned(m.phase_correlation_avg, 2)} · Width ${m.stereo_width_ratio.toFixed(2)}`,
      color: subPhase < 0 ? "#EF6B63" : subPhase >= 0.45 ? "#38D39F" : "#F0B44C",
      delta: comp ? `${formatSigned(comp.metric_deltas.phase_correlation_delta, 2)} CORR` : null,
    },
    {
      label: "DYNAMICS (PLR / PSR)",
      value: `${plr.toFixed(1)}`,
      unit: "dB",
      sub: `PSR ${m.psr_db.toFixed(1)} dB · Crest ${m.crest_factor_db.toFixed(1)} dB`,
      color: "#F0B44C",
      delta: comp ? `${formatSigned(comp.metric_deltas.psr_db_delta, 1)} dB PSR` : null,
    },
  ];

  metricCells.forEach((cell, idx) => {
    const cx = M + idx * colW;
    if (idx > 0) {
      ctx.strokeStyle = "#262C3A";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, metricsTop);
      ctx.lineTo(cx, metricsTop + metricsH);
      ctx.stroke();
    }

    ctx.fillStyle = "#98A2B3";
    ctx.font = "700 12px 'JetBrains Mono', monospace";
    ctx.fillText(cell.label, cx + 24, metricsTop + 34);

    ctx.fillStyle = cell.color;
    ctx.font = "800 42px 'JetBrains Mono', monospace";
    ctx.fillText(cell.value, cx + 24, metricsTop + 86);

    const valWidth = ctx.measureText(cell.value).width;
    ctx.fillStyle = "#98A2B3";
    ctx.font = "700 14px 'JetBrains Mono', monospace";
    ctx.fillText(cell.unit, cx + 24 + valWidth + 8, metricsTop + 94);

    ctx.fillStyle = "#98A2B3";
    ctx.font = "600 12px 'JetBrains Mono', monospace";
    ctx.fillText(cell.sub, cx + 24, metricsTop + 132);

    if (cell.delta) {
      ctx.fillStyle = "#38D39F";
      ctx.font = "700 12px 'JetBrains Mono', monospace";
      ctx.fillText(`Δ v1→v2: ${cell.delta}`, cx + 24, metricsTop + 152);
    }
  });

  // 5. Lower Proof Band: v1 -> v2 Status Shifts OR Top Findings (height 178px)
  const lowerTop = metricsTop + metricsH;
  const lowerH = 178;
  ctx.strokeStyle = "#14171F";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(M, lowerTop);
  ctx.lineTo(M + innerW, lowerTop);
  ctx.stroke();

  if (comp && comp.finding_statuses.length > 0) {
    const improvedCount = comp.finding_statuses.filter((f) => f.status === "improved").length;
    ctx.fillStyle = "#14171F";
    ctx.font = "800 14px 'JetBrains Mono', monospace";
    ctx.fillText(
      `V1 → V2 REVISION PROOF  ·  ${improvedCount} OF ${comp.finding_statuses.length} FINDINGS IMPROVED`,
      M + 24,
      lowerTop + 34
    );

    const items = comp.finding_statuses.slice(0, 3);
    const cardGap = 16;
    const cardW = (innerW - 48 - cardGap * 2) / 3;
    items.forEach((fs, idx) => {
      const bx = M + 24 + idx * (cardW + cardGap);
      const by = lowerTop + 54;
      const bh = 104;
      ctx.fillStyle = "#F2EFE7";
      ctx.fillRect(bx, by, cardW, bh);
      ctx.strokeStyle = "#14171F";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, cardW, bh);

      const badgeBg =
        fs.status === "improved"
          ? "#38D39F"
          : fs.status === "regressed"
            ? "#EF6B63"
            : "#F5C451";
      ctx.fillStyle = badgeBg;
      ctx.fillRect(bx + 12, by + 12, 92, 22);
      ctx.fillStyle = "#14171F";
      ctx.font = "800 11px 'JetBrains Mono', monospace";
      ctx.fillText(fs.status.toUpperCase(), bx + 20, by + 24);

      ctx.fillStyle = "#14171F";
      ctx.font = "700 14px 'Plus Jakarta Sans', Arial, sans-serif";
      ctx.fillText(truncateText(fs.title, 30), bx + 12, by + 56);

      ctx.fillStyle = "#475467";
      ctx.font = "600 12px 'JetBrains Mono', monospace";
      ctx.fillText(
        truncateText(`v1: ${fs.baseline_value} → v2: ${fs.revised_value}`, 38),
        bx + 12,
        by + 84
      );
    });
  } else {
    ctx.fillStyle = "#14171F";
    ctx.font = "800 14px 'JetBrains Mono', monospace";
    ctx.fillText("PRIORITIZED DETERMINISTIC EVIDENCE", M + 24, lowerTop + 34);

    const items = report.findings.slice(0, 3);
    const cardGap = 16;
    const cardW = (innerW - 48 - cardGap * 2) / 3;
    items.forEach((f, idx) => {
      const bx = M + 24 + idx * (cardW + cardGap);
      const by = lowerTop + 54;
      const bh = 104;
      ctx.fillStyle = "#F2EFE7";
      ctx.fillRect(bx, by, cardW, bh);
      ctx.strokeStyle = "#14171F";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, cardW, bh);

      const badgeBg =
        f.severity === "alert" ? "#EF6B63" : f.severity === "caution" ? "#F5C451" : "#38D39F";
      ctx.fillStyle = badgeBg;
      ctx.fillRect(bx + 12, by + 12, 80, 22);
      ctx.fillStyle = "#14171F";
      ctx.font = "800 11px 'JetBrains Mono', monospace";
      ctx.fillText(f.severity.toUpperCase(), bx + 20, by + 24);

      ctx.fillStyle = "#475467";
      ctx.font = "600 11px 'JetBrains Mono', monospace";
      ctx.fillText(f.evidence_id, bx + 104, by + 24);

      ctx.fillStyle = "#14171F";
      ctx.font = "700 14px 'Plus Jakarta Sans', Arial, sans-serif";
      ctx.fillText(truncateText(f.title, 30), bx + 12, by + 56);

      ctx.fillStyle = "#475467";
      ctx.font = "600 12px 'JetBrains Mono', monospace";
      ctx.fillText(truncateText(f.measured_value, 36), bx + 12, by + 84);
    });
  }

  // 6. Bottom Verification Footer Bar (remaining ~58px)
  const footTop = lowerTop + lowerH;
  const footH = M + innerH - footTop;
  ctx.fillStyle = "#F5C451";
  ctx.fillRect(M, footTop, innerW, footH);
  ctx.strokeStyle = "#14171F";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(M, footTop);
  ctx.lineTo(M + innerW, footTop);
  ctx.stroke();

  ctx.fillStyle = "#14171F";
  ctx.font = "800 13px 'JetBrains Mono', monospace";
  ctx.fillText(
    "MIXIT STUDIO · ITU-R BS.1770 LUFS · 4X TRUE PEAK · 20–120 HZ BANDPASS PHASE",
    M + 24,
    footTop + footH / 2
  );

  ctx.textAlign = "right";
  ctx.font = "700 12px 'JetBrains Mono', monospace";
  ctx.fillText(
    `REPORT ${report.report_id.toUpperCase()}`,
    M + innerW - 24,
    footTop + footH / 2
  );
  ctx.textAlign = "left";
}

/**
 * Generates and downloads a 1200x630 Swiss Neo-Brutalist Mixit Proof Scorecard PNG.
 */
export function downloadScorecardPng(report: AnalysisReport): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(false);
      return;
    }
    const canvas = document.createElement("canvas");
    renderScorecardToCanvas(canvas, report);

    const safeName = report.audio_metadata.filename
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_");
    const fileName = `Mixit_Scorecard_${safeName || "session"}.png`;

    const triggerLink = (url: string, revoke: boolean) => {
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (revoke) {
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      resolve(true);
    };

    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        if (!blob) {
          try {
            triggerLink(canvas.toDataURL("image/png"), false);
          } catch {
            resolve(false);
          }
          return;
        }
        const url = URL.createObjectURL(blob);
        triggerLink(url, true);
      }, "image/png");
    } else {
      try {
        triggerLink(canvas.toDataURL("image/png"), false);
      } catch {
        resolve(false);
      }
    }
  });
}
