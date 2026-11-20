/**
 * Shared numeric constants. Everything that touches gain staging, smoothing,
 * metering or persistence reads its limits from here so the UI and the engine
 * can never disagree.
 */

/** Fader value that means "-infinity" (silence). JSON cannot store -Infinity, so we use a floor. */
export const FADER_MIN_DB = -100;
export const FADER_MAX_DB = 6;

export const INPUT_GAIN_MIN_DB = -24;
export const INPUT_GAIN_MAX_DB = 24;

/** Universal per-plugin input/output trim range. */
export const TRIM_MIN_DB = -24;
export const TRIM_MAX_DB = 24;

/**
 * Time constant passed to `AudioParam.setTargetAtTime` for every Mute, Solo,
 * Bypass, Delta and other toggle. 15 ms exponential ramp => about 95 % settled
 * in 45 ms, which is far below the click threshold.
 */
export const RAMP_TC_S = 0.015;
/** Faster time constant for continuous controls (knobs/faders) to avoid zipper noise. */
export const PARAM_TC_S = 0.008;

/** dBFS value reported by meters for digital silence. */
export const METER_FLOOR_DB = -120;
export const PEAK_HOLD_MS = 1500;
export const PEAK_FALL_DB_PER_S = 20;
export const METER_FFT_SIZE = 2048;

/** Number of buckets in `TrackState.peaks`. */
export const PEAKS_RESOLUTION = 1024;

export const PROJECT_SCHEMA_VERSION = 1;
export const AUTOSAVE_DELAY_MS = 2000;

/** Transport scheduling. */
export const SCHEDULE_AHEAD_S = 2.0;
export const SCHEDULER_INTERVAL_MS = 25;
export const START_LEAD_S = 0.05;
export const SEEK_LEAD_S = 0.012;
export const FADE_IN_S = 0.006;
export const FADE_OUT_S = 0.01;

export const ACCEPTED_AUDIO_EXTENSIONS = ['wav', 'wave', 'mp3', 'flac', 'ogg', 'oga'] as const;
export const ACCEPTED_AUDIO_MIME = [
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
  'application/ogg',
] as const;

/** Special chain ids used by the plugin-chain APIs (anything else is a track id). */
export const CHAIN_MASTER = 'master';
export const CHAIN_RETURN_A = 'returnA';
export const CHAIN_RETURN_B = 'returnB';
