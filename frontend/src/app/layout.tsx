import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import { MotionConfig } from "motion/react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MixBench — Privacy-First Mix & Mastering Learning Workbench",
  description:
    "Learn mixing and mastering by doing mixing and mastering, powered by deterministic ITU-R BS.1770 / 4x True Peak DSP and opt-in Gemini mentoring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-[#FAFAFA] text-[#182220] antialiased">
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </body>
    </html>
  );
}
