import type { Metadata } from "next";
import { WebDawView } from "@/daw/ui/WebDawView";

export const metadata: Metadata = {
  title: "Mixit Web DAW — Multi-Track Browser Mixing & Mastering Engine",
  description:
    "Mix and master multi-track audio in the browser with 16 real-time plugins, 60 fps stereo peak and gain reduction meters, 24-bit WAV export, and 1-click DSP mix analysis.",
};

export default function WebDawPage() {
  return <WebDawView />;
}
