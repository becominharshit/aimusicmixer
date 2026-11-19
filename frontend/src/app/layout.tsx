import type { Metadata } from "next";
import { MotionConfig } from "motion/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MixBench — Privacy-First Mix & Mastering Learning Workbench",
  description:
    "Learn mixing and mastering by doing mixing and mastering, powered by deterministic ITU-R BS.1770 / 4x True Peak DSP and opt-in Gemini 4 Hydrogen mentoring.",
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
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Syne:wght@600;700;800&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] antialiased transition-colors duration-200">
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </body>
    </html>
  );
}
