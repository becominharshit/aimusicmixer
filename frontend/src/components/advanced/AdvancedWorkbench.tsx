"use client";

import React, { useState } from "react";
import { FindingCard } from "@/components/FindingCard";
import { DiagnosticCharts } from "@/components/advanced/DiagnosticCharts";
import { RevisionInspector } from "@/components/advanced/RevisionInspector";
import { StemsInspector } from "@/components/advanced/StemsInspector";
import { TranslationDeck } from "@/components/advanced/TranslationDeck";
import { WaveformStage } from "@/components/advanced/WaveformStage";
import { MentorPrivacyPanel } from "@/components/privacy/MentorPrivacyPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AudioSourceSlot, DeviceProfile, StereoMode } from "@/audio/StudioAudioEngine";
import type {
  AnalysisReport,
  Finding,
  MentorRequest,
  MentorResponse,
  ReferenceTrackMeta,
} from "@/types/report";

interface AdvancedWorkbenchProps {
  report: AnalysisReport;
  activeFindingId: string | null;
  audioState: {
    activeSource: AudioSourceSlot;
    stereoMode: StereoMode;
    deviceProfile: DeviceProfile;
    matchLoudness: boolean;
    loudnessOffsetDb: number;
    isPlaying: boolean;
    loopEnabled: boolean;
    loopStartSec: number;
    loopEndSec: number;
    hasReference: boolean;
    hasRevised: boolean;
  };
  referenceMeta: ReferenceTrackMeta | null;
  mentorAdvice: MentorResponse | null;
  isUploadingRef: boolean;
  isUploadingStems: boolean;
  isUploadingRevision: boolean;
  isAskingMentor: boolean;
  stemError: string | null;
  revisionError: string | null;
  onSeek: (timeSec: number) => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onChangeSource: (slot: AudioSourceSlot) => void;
  onChangeStereo: (mode: StereoMode) => void;
  onChangeDevice: (profile: DeviceProfile) => void;
  onToggleMatchLoudness: (val: boolean) => void;
  onUploadReference: (file: File) => void;
  onLoadDemoReference: () => void;
  onUploadStems: (files: File[]) => void;
  onLoadDemoStems: () => void;
  onUploadRevision: (file: File) => void;
  onLoadDemoRevision: () => void;
  onAuditionRevised: () => void;
  onSelectFinding: (finding: Finding) => void;
  onAuditionFinding: (finding: Finding) => void;
  onAskMentor: (req: MentorRequest) => void;
  onSaveDawContext: (ctx: { daw: string; bus_routing: string; plugin_notes: string }) => void;
}

export function AdvancedWorkbench({
  report,
  activeFindingId,
  audioState,
  referenceMeta,
  mentorAdvice,
  isUploadingRef,
  isUploadingStems,
  isUploadingRevision,
  isAskingMentor,
  stemError,
  revisionError,
  onSeek,
  onTogglePlay,
  onToggleLoop,
  onChangeSource,
  onChangeStereo,
  onChangeDevice,
  onToggleMatchLoudness,
  onUploadReference,
  onLoadDemoReference,
  onUploadStems,
  onLoadDemoStems,
  onUploadRevision,
  onLoadDemoRevision,
  onAuditionRevised,
  onSelectFinding,
  onAuditionFinding,
  onAskMentor,
  onSaveDawContext,
}: AdvancedWorkbenchProps) {
  const [sidebarTab, setSidebarTab] = useState("findings");
  const m = report.global_metrics;

  const handleJumpEvidence = (evidenceId: string) => {
    const match = report.findings.find((f) => f.evidence_id === evidenceId);
    if (match) {
      setSidebarTab("findings");
      onAuditionFinding(match);
    } else if (report.stem_analysis?.overlap_matrix.some((o) => o.evidence_id === evidenceId)) {
      setSidebarTab("stems");
    }
  };

  return (
    <div className="mx-auto max-w-[1380px] py-4">
      {/* Studio Asymmetric Two-Column Workbench */}
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Primary Acoustic Stage (8 cols on lg+) */}
        <div className="space-y-4 lg:col-span-8">
          {/* Compact Telemetry Ribbon */}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {[
              { label: "Integrated", val: `${m.integrated_lufs.toFixed(1)} LUFS` },
              {
                label: "4x True Peak",
                val: `${m.true_peak_dbtp >= 0 ? "+" : ""}${m.true_peak_dbtp.toFixed(2)} dBTP`,
                alert: m.true_peak_dbtp > -0.1,
              },
              { label: "Sample Peak", val: `${m.sample_peak_dbfs.toFixed(2)} dBFS` },
              { label: "LRA", val: `${m.loudness_range_lu.toFixed(1)} LU` },
              { label: "PSR", val: `${m.psr_db.toFixed(1)} dB` },
              {
                label: "Correlation",
                val: `${m.phase_correlation_avg >= 0 ? "+" : ""}${m.phase_correlation_avg.toFixed(2)}`,
                alert: m.phase_correlation_avg < 0,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-[#FFFFFF] px-3 py-2.5 hairline-border squircle-inner"
              >
                <div className="text-[11px] text-[#52605D]">{item.label}</div>
                <div
                  className={`mt-0.5 text-sm font-semibold tabular-telemetry ${
                    item.alert ? "text-[#BE123C]" : "text-[#182220]"
                  }`}
                >
                  {item.val}
                </div>
              </div>
            ))}
          </div>

          <WaveformStage
            peaks={report.audio_metadata.waveform_peaks}
            durationSec={report.audio_metadata.duration_sec}
            findings={report.findings}
            activeFindingId={activeFindingId}
            loopEnabled={audioState.loopEnabled}
            loopStartSec={audioState.loopStartSec}
            loopEndSec={audioState.loopEndSec}
            onSeek={onSeek}
            onSelectFinding={(finding) => {
              setSidebarTab("findings");
              onAuditionFinding(finding);
            }}
          />

          <TranslationDeck
            isPlaying={audioState.isPlaying}
            activeSource={audioState.activeSource}
            stereoMode={audioState.stereoMode}
            deviceProfile={audioState.deviceProfile}
            matchLoudness={audioState.matchLoudness}
            loudnessOffsetDb={audioState.loudnessOffsetDb}
            loopEnabled={audioState.loopEnabled}
            hasReference={audioState.hasReference}
            hasRevised={audioState.hasRevised}
            referenceMeta={referenceMeta}
            isUploadingRef={isUploadingRef}
            onTogglePlay={onTogglePlay}
            onToggleLoop={onToggleLoop}
            onChangeSource={onChangeSource}
            onChangeStereo={onChangeStereo}
            onChangeDevice={onChangeDevice}
            onToggleMatchLoudness={onToggleMatchLoudness}
            onUploadReference={onUploadReference}
            onLoadDemoReference={onLoadDemoReference}
          />

          <DiagnosticCharts report={report} onSeek={onSeek} />
        </div>

        {/* Right Inspector Sidebar (4 cols on lg+) */}
        <aside className="lg:col-span-4">
          <div className="sticky top-[74px] bg-[#F5F5F7] p-4 hairline-border squircle-outer">
            <Tabs value={sidebarTab} onValueChange={setSidebarTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="findings">
                  Findings ({report.findings.length})
                </TabsTrigger>
                <TabsTrigger value="stems">
                  Stems {report.context.has_user_stems ? `(${report.context.stem_count})` : ""}
                </TabsTrigger>
                <TabsTrigger value="revisions">
                  v1/v2
                </TabsTrigger>
                <TabsTrigger value="mentor">
                  Mentor
                </TabsTrigger>
              </TabsList>

              <TabsContent value="findings" className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
                {report.findings.map((finding, idx) => (
                  <FindingCard
                    key={finding.evidence_id}
                    finding={finding}
                    index={idx}
                    compact
                    isActive={activeFindingId === finding.evidence_id}
                    onSelect={onSelectFinding}
                    onAudition={onAuditionFinding}
                  />
                ))}
              </TabsContent>

              <TabsContent value="stems" className="max-h-[75vh] overflow-y-auto pr-1">
                <StemsInspector
                  report={report}
                  isUploading={isUploadingStems}
                  errorMessage={stemError}
                  onUploadStems={onUploadStems}
                  onLoadDemoStems={onLoadDemoStems}
                />
              </TabsContent>

              <TabsContent value="revisions" className="max-h-[75vh] overflow-y-auto pr-1">
                <RevisionInspector
                  report={report}
                  isUploading={isUploadingRevision}
                  errorMessage={revisionError}
                  onUploadRevision={onUploadRevision}
                  onLoadDemoRevision={onLoadDemoRevision}
                  onAuditionRevised={onAuditionRevised}
                />
              </TabsContent>

              <TabsContent value="mentor" className="max-h-[75vh] overflow-y-auto pr-1">
                <MentorPrivacyPanel
                  report={report}
                  mentorAdvice={mentorAdvice}
                  isAskingMentor={isAskingMentor}
                  onAskMentor={onAskMentor}
                  onSaveDawContext={onSaveDawContext}
                  onJumpToEvidence={handleJumpEvidence}
                />
              </TabsContent>
            </Tabs>
          </div>
        </aside>
      </div>
    </div>
  );
}
