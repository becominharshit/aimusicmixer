import { deriveSuggestedEq } from "@/components/FindingCard";
import { encodeWav, type PluginId } from "@/daw";
import type { Finding, StageType } from "@/types/report";

/**
 * Bidirectional client-side handoff bridge between Mixit Studio (/studio) and Web DAW (/daw):
 *  - /daw → /studio: rendered 24-bit WAV mixdown for deterministic DSP verification
 *  - /studio → /daw: active audio track + pre-configured plugin preset for instant repair
 */

let pendingMixdownFile: File | null = null;

export function setPendingDawMixdown(file: File): void {
  pendingMixdownFile = file;
}

export function consumePendingDawMixdown(): File | null {
  const file = pendingMixdownFile;
  pendingMixdownFile = null;
  return file;
}

export function hasPendingDawMixdown(): boolean {
  return pendingMixdownFile !== null;
}

export interface DawFixPreset {
  suggestedPluginId: PluginId;
  targetChain: "track" | "master";
  suggestedParams: Record<string, number>;
  freqHz?: number;
  gainDb?: number;
  summary: string;
}

export interface StudioToDawHandoff extends DawFixPreset {
  file: File;
  trackName: string;
  findingTitle: string;
  evidenceId: string;
  timestampStartSec?: number;
  timestampEndSec?: number;
}

let pendingStudioToDaw: StudioToDawHandoff | null = null;

export function setPendingStudioToDawHandoff(handoff: StudioToDawHandoff): void {
  pendingStudioToDaw = handoff;
}

export function consumePendingStudioToDawHandoff(): StudioToDawHandoff | null {
  const handoff = pendingStudioToDaw;
  pendingStudioToDaw = null;
  return handoff;
}

export function hasPendingStudioToDawHandoff(): boolean {
  return pendingStudioToDaw !== null;
}

/**
 * Maps any actionable Studio diagnostic finding to a real Mixit Web DAW processor
 * and calibrated starting-point parameters from PLUGIN_REGISTRY.
 */
export function deriveDawFixPreset(
  finding: Finding,
  stage: StageType = "unmastered_mix"
): DawFixPreset {
  if (finding.category === "true_peak" || finding.category === "technical_validation") {
    const ceiling = stage === "unmastered_mix" ? -2.5 : -1.0;
    return {
      suggestedPluginId: "master-limiter",
      targetChain: "master",
      suggestedParams: {
        ceiling,
        input: 0,
        release: 100,
      },
      summary: `Master Limiter (${ceiling.toFixed(1)} dBTP ceiling)`,
    };
  }

  if (finding.category === "dynamics" || finding.category === "loudness") {
    return {
      suggestedPluginId: "vca-bus-comp",
      targetChain: "track",
      suggestedParams: {
        threshold: -14,
        ratio: 2.0,
        attack: 30,
        release: 250,
        scHpf: 90,
        makeup: 1.5,
      },
      summary: "VCA Bus Comp (2:1 glue, 30 ms attack)",
    };
  }

  if (finding.category === "stereo_phase") {
    return {
      suggestedPluginId: "gain-staging-utility",
      targetChain: "track",
      suggestedParams: {
        width: 70,
        trim: 0,
        monoFold: 0,
      },
      summary: "Gain Staging Utility (70% width & mono check)",
    };
  }

  // Default & tonal_balance: Proportional-Q EQ dialed to the exact measured band
  const suggestedEq = deriveSuggestedEq(finding);
  const freqHz = Math.round(suggestedEq?.freqHz ?? 250);
  const gainDb = Number((suggestedEq?.gainDb ?? -2.0).toFixed(1));

  if (freqHz <= 350) {
    return {
      suggestedPluginId: "proportional-q-eq",
      targetChain: "track",
      suggestedParams: {
        lowFreq: Math.max(30, Math.min(500, freqHz)),
        lowGain: Math.max(-12, Math.min(12, gainDb)),
      },
      freqHz,
      gainDb,
      summary: `Proportional-Q EQ (${gainDb >= 0 ? "+" : ""}${gainDb} dB @ ${freqHz} Hz)`,
    };
  }

  if (freqHz <= 4000) {
    return {
      suggestedPluginId: "proportional-q-eq",
      targetChain: "track",
      suggestedParams: {
        midFreq: Math.max(200, Math.min(5000, freqHz)),
        midGain: Math.max(-12, Math.min(12, gainDb)),
      },
      freqHz,
      gainDb,
      summary: `Proportional-Q EQ (${gainDb >= 0 ? "+" : ""}${gainDb} dB @ ${freqHz} Hz)`,
    };
  }

  return {
    suggestedPluginId: "proportional-q-eq",
    targetChain: "track",
    suggestedParams: {
      highFreq: Math.max(2000, Math.min(16000, freqHz)),
      highGain: Math.max(-12, Math.min(12, gainDb)),
    },
    freqHz,
    gainDb,
    summary: `Proportional-Q EQ (${gainDb >= 0 ? "+" : ""}${gainDb} dB @ ${freqHz} Hz)`,
  };
}

/**
 * Encodes an in-memory Web Audio AudioBuffer into a canonical 16-bit WAV File so
 * cloud-restored mixes can be sent straight into /daw even without the original File handle.
 */
export function audioBufferToWavFile(buffer: AudioBuffer, originalFilename: string): File {
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c += 1) {
    channels.push(buffer.getChannelData(c));
  }
  const encoded = encodeWav(channels, buffer.sampleRate, { bitDepth: 16, dither: false });
  const baseName = originalFilename.replace(/\.[^.]+$/, "") || "mix_track";
  const wavBlob = new Blob([encoded.bytes], { type: "audio/wav" });
  return new File([wavBlob], `${baseName}.wav`, { type: "audio/wav" });
}
