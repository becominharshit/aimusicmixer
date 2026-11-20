import type { TrackState } from '../types';
import type { MixerGraph } from './MixerGraph';

export interface ClipSegment {
  /** Context time at which the segment starts. */
  when: number;
  /** Offset into the source AudioBuffer in seconds. */
  offset: number;
  /** Segment length in seconds. */
  duration: number;
}

/**
 * Pure planning function: which part of a track's clip plays when the timeline window
 * [fromPos, toPos) is scheduled so that `fromPos` lands on context time `whenCtx`.
 * Returns null when the clip does not overlap the window.
 */
export function planClipSegment(
  track: TrackState,
  bufferDurationSec: number,
  fromPos: number,
  toPos: number,
  whenCtx: number,
): ClipSegment | null {
  const srcStart = track.clip.trimStartSec;
  const srcEnd = bufferDurationSec - track.clip.trimEndSec;
  if (!(srcEnd > srcStart)) return null;
  const clipStart = track.clip.startSec;
  const clipEnd = clipStart + (srcEnd - srcStart);
  const a = Math.max(fromPos, clipStart);
  const b = Math.min(toPos, clipEnd);
  if (!(b - a > 1e-4)) return null;
  return {
    when: whenCtx + (a - fromPos),
    offset: srcStart + (a - clipStart),
    duration: b - a,
  };
}

export interface ScheduledSource {
  trackId: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Schedules one source node per track clip, all against the same `whenCtx` reference so playback is
 * sample-locked across tracks. Returns the created nodes so the transport can fade/stop them.
 */
export function scheduleSegments(
  ctx: BaseAudioContext,
  graph: MixerGraph,
  tracks: readonly TrackState[],
  buffers: ReadonlyMap<string, AudioBuffer>,
  fromPos: number,
  toPos: number,
  whenCtx: number,
  fadeInSec: number,
  onEnded?: (s: ScheduledSource) => void,
): ScheduledSource[] {
  const out: ScheduledSource[] = [];
  for (const track of tracks) {
    const buffer = buffers.get(track.id);
    const strip = graph.strips.get(track.id);
    if (!buffer || !strip) continue;
    const seg = planClipSegment(track, buffer.duration, fromPos, toPos, whenCtx);
    if (!seg) continue;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    if (fadeInSec > 0) {
      gain.gain.setValueAtTime(0, seg.when);
      gain.gain.linearRampToValueAtTime(1, seg.when + fadeInSec);
    }
    src.connect(gain);
    gain.connect(strip.input);
    src.start(seg.when, seg.offset, seg.duration);

    const scheduled: ScheduledSource = { trackId: track.id, src, gain };
    src.onended = () => {
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
      onEnded?.(scheduled);
    };
    out.push(scheduled);
  }
  return out;
}
