import type { Metadata } from "next";
import { MotionConfig } from "motion/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MixBench — Deterministic Mix & Mastering Diagnostics Studio",
  description:
    "Hear every mix flaw and prove every fix with deterministic ITU-R BS.1770 loudness, 4x True Peak, 20–120 Hz sub-bass phase DSP, and privacy-first Gemini 4 Hydrogen studio coaching.",
};

const themeInitScript = `
(function() {
  try {
    var saved = window.localStorage.getItem("mixbench_theme");
    var root = document.documentElement;
    if (saved === "light") {
      root.classList.remove("dark");
      root.dataset.theme = "light";
    } else {
      root.classList.add("dark");
      root.dataset.theme = "dark";
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] antialiased transition-colors duration-200">
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </body>
    </html>
  );
}
