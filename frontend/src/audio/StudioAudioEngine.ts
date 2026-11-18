export type AudioSourceSlot = "primary" | "reference" | "revised";
export type StereoMode = "stereo" | "mono";
export type DeviceProfile = "full" | "smartphone" | "laptop";

export interface CorrectiveEqConfig {
  id: string;
  freqHz: number;
  q: number;
  gainDb: number;
}

interface SlotState {
  buffer: AudioBuffer | null;
  lufs: number | null;
  url: string | null;
}

/**
 * Persistent Web Audio API Studio Engine.
 * - Lives outside React component trees so Simple <-> Advanced switching never glitches audio.
 * - Unlocks suspended AudioContext synchronously on user gestures (Safari / iOS WebKit safe).
 * - Uses 15ms exponential GainNode ramps (`setTargetAtTime`) on every play/pause, A/B, mono, and EQ toggle.
 * - Uses calibrated 0.5L + 0.5R mono summing into a -0.3 dBFS brickwall safety limiter to prevent digital clipping.
 * - Includes a bypassable Corrective EQ peaking filter (`correctiveEqFilter`) for tonal finding auditioning.
 */
export class StudioAudioEngine {
  private ctx: AudioContext | null = null;

  private slots: Record<AudioSourceSlot, SlotState> = {
    primary: { buffer: null, lufs: null, url: null },
    reference: { buffer: null, lufs: null, url: null },
    revised: { buffer: null, lufs: null, url: null },
  };

  private activeSource: AudioSourceSlot = "primary";
  private stereoMode: StereoMode = "stereo";
  private deviceProfile: DeviceProfile = "full";
  private matchLoudness = true;
  private correctiveEq: CorrectiveEqConfig | null = null;

  private isPlaying = false;
  private startCtxTime = 0;
  private offsetSec = 0;
  private loopEnabled = false;
  private loopStartSec = 0;
  private loopEndSec = 0;

  private currentNode: AudioBufferSourceNode | null = null;
  private sourceGainNode: GainNode | null = null;

  // Stereo / Mono / Laptop width matrix nodes
  private splitter: ChannelSplitterNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private llGain: GainNode | null = null;
  private lrGain: GainNode | null = null;
  private rlGain: GainNode | null = null;
  private rrGain: GainNode | null = null;

  // Bypassable corrective EQ node
  private correctiveEqFilter: BiquadFilterNode | null = null;

  // Device Translation Lab filter chain + speaker makeup gain + brickwall safety limiter
  private hpFilter: BiquadFilterNode | null = null;
  private midPresenceFilter: BiquadFilterNode | null = null;
  private lpFilter: BiquadFilterNode | null = null;
  private makeupGainNode: GainNode | null = null;
  private safetyLimiter: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;

  private listeners = new Set<() => void>();
  private loopMonitorId: number | null = null;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  private unlockContextSync(ctx: AudioContext): void {
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  }

  private ensureGraph(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (!this.masterGain) {
      const ctx = this.ctx;
      this.sourceGainNode = ctx.createGain();
      this.splitter = ctx.createChannelSplitter(2);
      this.merger = ctx.createChannelMerger(2);

      this.llGain = ctx.createGain();
      this.lrGain = ctx.createGain();
      this.rlGain = ctx.createGain();
      this.rrGain = ctx.createGain();

      // Matrix: L_out = ll*L + rl*R ; R_out = lr*L + rr*R
      this.sourceGainNode.connect(this.splitter);
      this.splitter.connect(this.llGain, 0);
      this.splitter.connect(this.lrGain, 0);
      this.splitter.connect(this.rlGain, 1);
      this.splitter.connect(this.rrGain, 1);

      this.llGain.connect(this.merger, 0, 0);
      this.rlGain.connect(this.merger, 0, 0);
      this.lrGain.connect(this.merger, 0, 1);
      this.rrGain.connect(this.merger, 0, 1);

      this.correctiveEqFilter = ctx.createBiquadFilter();
      this.correctiveEqFilter.type = "peaking";
      this.correctiveEqFilter.frequency.value = 250;
      this.correctiveEqFilter.Q.value = 1.4;
      this.correctiveEqFilter.gain.value = 0;

      this.hpFilter = ctx.createBiquadFilter();
      this.midPresenceFilter = ctx.createBiquadFilter();
      this.lpFilter = ctx.createBiquadFilter();
      this.makeupGainNode = ctx.createGain();
      this.makeupGainNode.gain.value = 1.0;

      // Brickwall safety limiter (-0.3 dBFS) prevents LUFS-matched or speaker-boosted signals from clipping DAC
      this.safetyLimiter = ctx.createDynamicsCompressor();
      this.safetyLimiter.threshold.value = -0.3;
      this.safetyLimiter.knee.value = 0;
      this.safetyLimiter.ratio.value = 20;
      this.safetyLimiter.attack.value = 0.001;
      this.safetyLimiter.release.value = 0.05;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 0.0001;

      this.merger.connect(this.correctiveEqFilter);
      this.correctiveEqFilter.connect(this.hpFilter);
      this.hpFilter.connect(this.midPresenceFilter);
      this.midPresenceFilter.connect(this.lpFilter);
      this.lpFilter.connect(this.makeupGainNode);
      this.makeupGainNode.connect(this.safetyLimiter);
      this.safetyLimiter.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);

      this.applyMatrixAndFilters(true);
      this.applyCorrectiveEq(true);
      this.applyLoudnessGain(true);
    }
    return this.ctx;
  }

  async loadSlot(slot: AudioSourceSlot, url: string, lufs: number | null): Promise<void> {
    if (this.slots[slot].url === url && this.slots[slot].buffer) {
      this.slots[slot].lufs = lufs;
      this.applyLoudnessGain(false);
      this.emit();
      return;
    }

    const ctx = this.ensureGraph();
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Could not fetch audio proxy for ${slot} (${res.status}).`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    // Explicitly release prior AudioBuffer reference before assigning the new one
    this.slots[slot].buffer = null;
    this.slots[slot] = { buffer: decoded, lufs, url };

    if (slot === "primary" && this.loopEndSec <= 0) {
      this.loopStartSec = 0;
      this.loopEndSec = decoded.duration;
    }
    this.applyLoudnessGain(false);
    this.emit();
  }

  clearSlot(slot: AudioSourceSlot): void {
    if (this.activeSource === slot && this.isPlaying) {
      this.pause();
    }
    this.slots[slot] = { buffer: null, lufs: null, url: null };
    if (this.activeSource === slot && slot !== "primary") {
      this.activeSource = "primary";
      this.applyLoudnessGain(false);
    }
    this.emit();
  }

  getSlotLoaded(slot: AudioSourceSlot): boolean {
    return this.slots[slot].buffer !== null;
  }

  getDurationSec(): number {
    const activeBuf = this.slots[this.activeSource].buffer || this.slots.primary.buffer;
    return activeBuf ? activeBuf.duration : 0;
  }

  getCurrentTimeSec(): number {
    const dur = this.getDurationSec();
    if (!this.isPlaying || !this.ctx) {
      return Math.min(this.offsetSec, dur);
    }
    const elapsed = this.ctx.currentTime - this.startCtxTime;
    const rawPos = this.offsetSec + elapsed;
    if (this.loopEnabled && this.loopEndSec > this.loopStartSec + 0.1) {
      const span = this.loopEndSec - this.loopStartSec;
      if (rawPos >= this.loopStartSec) {
        return this.loopStartSec + ((rawPos - this.loopStartSec) % span);
      }
    }
    return dur > 0 ? Math.min(rawPos, dur) : rawPos;
  }

  getState() {
    return {
      activeSource: this.activeSource,
      stereoMode: this.stereoMode,
      deviceProfile: this.deviceProfile,
      matchLoudness: this.matchLoudness,
      activeCorrectiveEqId: this.correctiveEq?.id ?? null,
      isPlaying: this.isPlaying,
      loopEnabled: this.loopEnabled,
      loopStartSec: this.loopStartSec,
      loopEndSec: this.loopEndSec,
      hasPrimary: this.slots.primary.buffer !== null,
      hasReference: this.slots.reference.buffer !== null,
      hasRevised: this.slots.revised.buffer !== null,
      loudnessOffsetDb: this.getActiveGainOffsetDb(),
    };
  }

  getActiveGainOffsetDb(): number {
    if (!this.matchLoudness || this.activeSource === "primary") {
      return 0;
    }
    const primaryLufs = this.slots.primary.lufs;
    const slotLufs = this.slots[this.activeSource].lufs;
    if (primaryLufs === null || slotLufs === null) {
      return 0;
    }
    return Math.max(-18.0, Math.min(12.0, primaryLufs - slotLufs));
  }

  private applyLoudnessGain(immediate: boolean): void {
    if (!this.ctx || !this.sourceGainNode) return;
    const gainDb = this.getActiveGainOffsetDb();
    const linear = Math.pow(10, gainDb / 20);
    const now = this.ctx.currentTime;
    if (immediate) {
      this.sourceGainNode.gain.setValueAtTime(linear, now);
    } else {
      this.sourceGainNode.gain.setTargetAtTime(linear, now, 0.015);
    }
  }

  private applyCorrectiveEq(immediate: boolean): void {
    if (!this.ctx || !this.correctiveEqFilter) return;
    const now = this.ctx.currentTime;
    const tau = 0.015;
    const freq = this.correctiveEq ? Math.max(20, Math.min(20000, this.correctiveEq.freqHz)) : 250;
    const q = this.correctiveEq ? Math.max(0.2, Math.min(10, this.correctiveEq.q)) : 1.4;
    const gain = this.correctiveEq ? Math.max(-12, Math.min(12, this.correctiveEq.gainDb)) : 0;

    if (immediate) {
      this.correctiveEqFilter.frequency.setValueAtTime(freq, now);
      this.correctiveEqFilter.Q.setValueAtTime(q, now);
      this.correctiveEqFilter.gain.setValueAtTime(gain, now);
    } else {
      this.correctiveEqFilter.frequency.setTargetAtTime(freq, now, tau);
      this.correctiveEqFilter.Q.setTargetAtTime(q, now, tau);
      this.correctiveEqFilter.gain.setTargetAtTime(gain, now, tau);
    }
  }

  private applyMatrixAndFilters(immediate: boolean): void {
    if (
      !this.ctx ||
      !this.llGain ||
      !this.lrGain ||
      !this.rlGain ||
      !this.rrGain ||
      !this.hpFilter ||
      !this.midPresenceFilter ||
      !this.lpFilter ||
      !this.makeupGainNode
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const tau = 0.015;

    // Smartphone always collapses to mono; explicit Mono toggle folds to peak-safe 0.5L + 0.5R
    let ll = 1;
    let lr = 0;
    let rl = 0;
    let rr = 1;
    if (this.stereoMode === "mono" || this.deviceProfile === "smartphone") {
      ll = 0.5;
      lr = 0.5;
      rl = 0.5;
      rr = 0.5;
    } else if (this.deviceProfile === "laptop") {
      // Narrowed laptop speaker acoustic crossfeed
      ll = 0.72;
      lr = 0.28;
      rl = 0.28;
      rr = 0.72;
    }

    const setG = (node: GainNode, val: number) => {
      if (immediate) {
        node.gain.setValueAtTime(val, now);
      } else {
        node.gain.setTargetAtTime(val, now, tau);
      }
    };
    setG(this.llGain, ll);
    setG(this.lrGain, lr);
    setG(this.rlGain, rl);
    setG(this.rrGain, rr);

    if (this.deviceProfile === "smartphone") {
      // Generic Smartphone: band-limited 300 Hz - 4.5 kHz + mono fold + +2.5 dB makeup gain
      this.hpFilter.type = "highpass";
      this.hpFilter.frequency.setTargetAtTime(300, now, tau);
      this.hpFilter.Q.setTargetAtTime(0.75, now, tau);

      this.midPresenceFilter.type = "peaking";
      this.midPresenceFilter.frequency.setTargetAtTime(2000, now, tau);
      this.midPresenceFilter.Q.setTargetAtTime(1.0, now, tau);
      this.midPresenceFilter.gain.setTargetAtTime(2.0, now, tau);

      this.lpFilter.type = "lowpass";
      this.lpFilter.frequency.setTargetAtTime(4500, now, tau);
      this.lpFilter.Q.setTargetAtTime(0.75, now, tau);

      setG(this.makeupGainNode, Math.pow(10, 2.5 / 20));
    } else if (this.deviceProfile === "laptop") {
      // Generic Laptop Speakers: calibrated 150 Hz - 8 kHz narrowed stereo profile + +1.5 dB makeup gain
      this.hpFilter.type = "highpass";
      this.hpFilter.frequency.setTargetAtTime(150, now, tau);
      this.hpFilter.Q.setTargetAtTime(0.75, now, tau);

      this.midPresenceFilter.type = "peaking";
      this.midPresenceFilter.frequency.setTargetAtTime(1800, now, tau);
      this.midPresenceFilter.Q.setTargetAtTime(0.9, now, tau);
      this.midPresenceFilter.gain.setTargetAtTime(0.8, now, tau);

      this.lpFilter.type = "lowpass";
      this.lpFilter.frequency.setTargetAtTime(8000, now, tau);
      this.lpFilter.Q.setTargetAtTime(0.75, now, tau);

      setG(this.makeupGainNode, Math.pow(10, 1.5 / 20));
    } else {
      // Full Range flat bypass
      this.hpFilter.type = "allpass";
      this.hpFilter.frequency.setTargetAtTime(20, now, tau);
      this.midPresenceFilter.type = "peaking";
      this.midPresenceFilter.gain.setTargetAtTime(0, now, tau);
      this.lpFilter.type = "lowpass";
      this.lpFilter.frequency.setTargetAtTime(22000, now, tau);
      this.lpFilter.Q.setTargetAtTime(0.707, now, tau);

      setG(this.makeupGainNode, 1.0);
    }
  }

  private stopCurrentSourceNode(): void {
    if (this.currentNode) {
      try {
        this.currentNode.onended = null;
        this.currentNode.stop();
        this.currentNode.disconnect();
      } catch {
        // Already stopped
      }
      this.currentNode = null;
    }
    if (this.loopMonitorId !== null) {
      window.clearInterval(this.loopMonitorId);
      this.loopMonitorId = null;
    }
  }

  private startPlaybackAt(posSec: number): void {
    const ctx = this.ensureGraph();
    this.unlockContextSync(ctx);
    const buf = this.slots[this.activeSource].buffer || this.slots.primary.buffer;
    if (!buf || !this.sourceGainNode || !this.masterGain) return;

    this.stopCurrentSourceNode();

    const safePos = Math.max(0, Math.min(posSec, Math.max(0, buf.duration - 0.02)));
    const node = ctx.createBufferSource();
    node.buffer = buf;

    if (this.loopEnabled && this.loopEndSec > this.loopStartSec + 0.1) {
      node.loop = true;
      node.loopStart = Math.max(0, this.loopStartSec);
      node.loopEnd = Math.min(buf.duration, this.loopEndSec);
    }

    node.connect(this.sourceGainNode);
    this.startCtxTime = ctx.currentTime;
    this.offsetSec = safePos;
    this.isPlaying = true;
    this.currentNode = node;

    node.onended = () => {
      if (this.currentNode === node && !node.loop) {
        this.isPlaying = false;
        this.offsetSec = 0;
        this.currentNode = null;
        this.emit();
      }
    };

    node.start(0, safePos);
    // 15ms click-free fade-in
    this.masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.masterGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.015);
    this.emit();
  }

  async play(): Promise<void> {
    const ctx = this.ensureGraph();
    // Call resume() synchronously inside user gesture before awaiting so Safari/iOS unlocks cleanly
    const resumePromise = ctx.state === "suspended" ? ctx.resume() : null;
    if (resumePromise) {
      await resumePromise;
    }
    if (this.isPlaying) return;
    this.startPlaybackAt(this.offsetSec);
  }

  pause(): void {
    if (!this.isPlaying || !this.ctx || !this.masterGain) return;
    this.offsetSec = this.getCurrentTimeSec();
    this.isPlaying = false;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(0.0001, now, 0.015);
    const nodeRef = this.currentNode;
    window.setTimeout(() => {
      if (!this.isPlaying && this.currentNode === nodeRef) {
        this.stopCurrentSourceNode();
      }
    }, 55);
    this.emit();
  }

  async togglePlay(): Promise<void> {
    if (this.isPlaying) {
      this.pause();
    } else {
      await this.play();
    }
  }

  async seek(timeSec: number, autoPlay = false): Promise<void> {
    const dur = this.getDurationSec();
    const clamped = Math.max(0, Math.min(timeSec, dur));
    this.offsetSec = clamped;
    if (this.isPlaying || autoPlay) {
      const ctx = this.ensureGraph();
      const resumePromise = ctx.state === "suspended" ? ctx.resume() : null;
      if (resumePromise) {
        await resumePromise;
      }
      this.startPlaybackAt(clamped);
    } else {
      this.emit();
    }
  }

  async auditionRange(startSec: number, endSec: number): Promise<void> {
    const ctx = this.ensureGraph();
    this.unlockContextSync(ctx);
    const dur = this.getDurationSec();
    const s = Math.max(0, Math.min(startSec, Math.max(0, dur - 0.5)));
    const e = Math.max(s + 1.0, Math.min(endSec, dur));
    this.loopStartSec = s;
    this.loopEndSec = e;
    this.loopEnabled = true;
    await this.seek(s, true);
  }

  setLoop(enabled: boolean, startSec?: number, endSec?: number): void {
    this.loopEnabled = enabled;
    if (typeof startSec === "number") this.loopStartSec = Math.max(0, startSec);
    if (typeof endSec === "number") this.loopEndSec = Math.max(this.loopStartSec + 0.5, endSec);
    if (this.isPlaying) {
      const cur = this.getCurrentTimeSec();
      this.startPlaybackAt(cur);
    } else {
      this.emit();
    }
  }

  async setActiveSource(slot: AudioSourceSlot): Promise<void> {
    if (this.activeSource === slot || !this.slots[slot].buffer) return;
    if (this.ctx) this.unlockContextSync(this.ctx);
    const curPos = this.getCurrentTimeSec();
    this.activeSource = slot;
    this.applyLoudnessGain(false);
    if (this.isPlaying) {
      const slotDur = this.slots[slot].buffer?.duration || curPos;
      this.startPlaybackAt(Math.min(curPos, Math.max(0, slotDur - 0.1)));
    } else {
      this.emit();
    }
  }

  setStereoMode(mode: StereoMode): void {
    if (this.stereoMode === mode) return;
    if (this.ctx) this.unlockContextSync(this.ctx);
    this.stereoMode = mode;
    this.applyMatrixAndFilters(false);
    this.emit();
  }

  setDeviceProfile(profile: DeviceProfile): void {
    if (this.deviceProfile === profile) return;
    if (this.ctx) this.unlockContextSync(this.ctx);
    this.deviceProfile = profile;
    this.applyMatrixAndFilters(false);
    this.emit();
  }

  setMatchLoudness(enabled: boolean): void {
    if (this.matchLoudness === enabled) return;
    this.matchLoudness = enabled;
    this.applyLoudnessGain(false);
    this.emit();
  }

  setCorrectiveEq(eq: CorrectiveEqConfig | null): void {
    if (this.ctx) this.unlockContextSync(this.ctx);
    if (eq && this.correctiveEq?.id === eq.id) {
      this.correctiveEq = null;
    } else {
      this.correctiveEq = eq;
    }
    this.applyCorrectiveEq(false);
    this.emit();
  }

  reset(): void {
    this.stopCurrentSourceNode();
    this.isPlaying = false;
    this.offsetSec = 0;
    this.activeSource = "primary";
    this.stereoMode = "stereo";
    this.deviceProfile = "full";
    this.correctiveEq = null;
    this.loopEnabled = false;
    this.loopStartSec = 0;
    this.loopEndSec = 0;
    this.slots = {
      primary: { buffer: null, lufs: null, url: null },
      reference: { buffer: null, lufs: null, url: null },
      revised: { buffer: null, lufs: null, url: null },
    };
    this.applyMatrixAndFilters(true);
    this.applyCorrectiveEq(true);
    this.applyLoudnessGain(true);
    this.emit();
  }
}

export const studioAudioEngine = new StudioAudioEngine();
