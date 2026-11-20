"use client";

import React from "react";
import { StudioHeader, type StudioHeaderProps } from "@/components/StudioHeader";
import { StudioSidebar, type StudioSidebarProps } from "@/components/studio/StudioSidebar";

interface StudioShellProps {
  headerProps: StudioHeaderProps;
  sidebarProps: StudioSidebarProps;
  subHeader?: React.ReactNode;
  children: React.ReactNode;
  transportDock?: React.ReactNode;
  footer?: React.ReactNode;
  overlays?: React.ReactNode;
}

/**
 * Breathable Spatial Studio Shell:
 * - Left: Collapsible Icon Rail (64px <-> 240px on desktop, slide-over drawer on mobile < 768px)
 * - Right: Minimal 4-item sticky top navbar, optional sub-nav/context bar, scrollable canvas,
 *   sticky full-column transport dock (never covers left sidebar controls), and footer.
 */
export function StudioShell({
  headerProps,
  sidebarProps,
  subHeader,
  children,
  transportDock,
  footer,
  overlays,
}: StudioShellProps) {
  return (
    <div
      data-testid="studio-shell"
      className="flex min-h-screen w-full bg-[var(--bg-canvas)] text-[var(--text-primary)]"
    >
      <StudioSidebar {...sidebarProps} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <StudioHeader {...headerProps} />
        {subHeader}
        <div className="flex flex-1 flex-col">{children}</div>
        {footer}
        {transportDock}
      </div>

      {overlays}
    </div>
  );
}
