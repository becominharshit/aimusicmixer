import type { Metadata } from "next";
import { StudioWorkbench } from "@/components/studio/StudioWorkbench";

export const metadata: Metadata = {
  title: "Mixit Studio — Deterministic Audio DSP Workbench",
  description:
    "Upload stereo mixes and stems to Mixit for deterministic ITU-R BS.1770 loudness, 4x True Peak, 20–120 Hz phase analysis, v1 to v2 revision proofs, and privacy-first Gemini 4 Hydrogen coaching.",
};

export default function StudioPage() {
  return <StudioWorkbench />;
}
