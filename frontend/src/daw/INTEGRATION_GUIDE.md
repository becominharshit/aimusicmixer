# INTEGRATION_GUIDE — mixlearn-web-daw-core

**Audience:** Antigravity (UI agent, Ableton-Live-workflow layout).
**Contract:** this package is 100% headless. It has no JSX, CSS, colors or layout. You own every pixel; it owns every sample.

```ts
import {
  useDawController, useDawEngine, useDawProject, useDawProjectSelector, useDawMeters,
  PLUGIN_REGISTRY, PLUGIN_CATEGORIES, getPluginDescriptor,
  createDawController, createSupabaseProjectAdapter,
  FADER_MIN_DB, FADER_MAX_DB,
} from 'mixlearn-web-daw-core';
import type {
  ProjectState, TrackState, PluginState, PluginDescriptor, ParamDescriptor, MeterFrame, ChainId,
} from 'mixlearn-web-daw-core';
```

## 0. Requirements

| Item | Note |
| --- | --- |
| Secure context | `AudioWorklet` only exists on `https://` or `localhost`. The compressors and limiters need it. |
| TypeScript ≥ 5.7 | The package uses the generic `Float32Array<ArrayBuffer>` types. |
| React ≥ 18 | `useSyncExternalStore`. React is an optional peer dependency. |
| CSP | DSP is loaded from a Blob URL. Allow `worker-src blob:` / `script-src blob:`, or host a file containing `DAW_WORKLET_SOURCE` and call `configureWorklets({ moduleUrl })` before `init()`. |
| Autoplay | The first `play()` must come from a user gesture. The engine resumes the context itself. |

Conventions you must display correctly:

- **Gain reduction is positive dB** (`gr = 6` means 6 dB of compression). Draw it as a downward meter.
- **Faders** are in dB, `FADER_MIN_DB` (−100) means −∞, max is `+6`. Input gain and plugin trims are ±24 dB.
- **Pan** is −1 (L) … +1 (R), balance law.
- **No automation lanes in v1.** All parameters are static per project state.
- **Mix/master only.** No MIDI, no instruments, no piano roll.

## 1. Mount the engine once

```tsx
const daw = useDawController({ projectId: urlProjectId });   // autoInit: creates context + loads worklets
```

`useDawController()` returns **every action** plus a `snapshot`:

```ts
const {
  snapshot,        // { ready, project, transport, autosave, missingAudioTrackIds, loadingProject, export, error }
  controller,      // the DawController (framework-agnostic)
  // transport
  play, pause, stop, togglePlay, seek, setLoop,
  // tracks
  importFile, addTrack, removeTrack, moveTrack, reorderTracks, renameTrack,
  setTrackInputGain, setTrackPhaseInvert, setTrackFader, setTrackPan,
  setTrackMute, setTrackSolo, setTrackSend, setTrackClip, relinkTrackAudio,
  // returns + master
  setReturnFader, setReturnMute, setMasterFader,
  // device rack
  addPlugin, removePlugin, movePlugin, setPluginParam, setPluginBypass,
  togglePluginAB, copyPluginAToB, setPluginDeltaListen,
  setPluginInputTrim, setPluginOutputTrim, loadPluginPreset,
  // project
  newProject, openProject, listProjects, saveNow, duplicateProject, deleteProject, renameProject,
  // export
  exportMixdownWav, sendMixdownToAnalyzer, setOnSendToAnalyzer,
  // meters (no re-render)
  getMeterFrame, getPositionSec, getPluginMeters, resetPeakHolds,
  clearError,
} = daw;
```

All actions are stable bound functions: safe to destructure, pass as props, or use in `useEffect` deps.

Pass the Supabase client once, on the first mount of the app:

```ts
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(URL, ANON_KEY);

useDawController({
  adapter: createSupabaseProjectAdapter(supabase),   // table daw_projects; RLS scopes rows to auth.uid()
  onSendToAnalyzer: (wavFile) => mixLearnStudio.analyze(wavFile),
});
```

Run `src/storage/supabase_daw_projects.sql` in the Supabase SQL editor once. It creates `daw_projects` with strict RLS (`auth.uid() = user_id`). Without an adapter the controller falls back to `localStorage`, then to memory.

## 2. Hooks

| Hook | Returns | Re-renders on |
| --- | --- | --- |
| `useDawController(opts?)` | all actions + `snapshot` + `controller` | any snapshot change |
| `useDawEngine()` | `{ engine, ready, transport, play, pause, stop, togglePlay, seek, setLoop, getPositionSec }` | play state, loop, duration, ready |
| `useDawProject()` | `{ project, tracks, returnA, returnB, master, anySolo, projectName }` | any project edit |
| `useDawProjectSelector(sel, controller?, isEqual?)` | the selected slice | only when the slice changes |
| `useDawMeters(onFrame?)` | `{ getMeterFrame, getPositionSec, getPluginMeters, resetPeakHolds }` | **never** |

Performance rule: a channel strip should use `useDawProjectSelector((p) => p.tracks.find(t => t.id === id))`, so moving one fader does not re-render every strip.

## 3. Metering: never put meters in React state

```tsx
function MeterBridge() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useDawMeters((frame: MeterFrame) => {
    // frame is ONE shared object, reused every call. Read it, draw, do not keep it.
    for (let i = 0; i < frame.trackCount; i++) {
      const ch = frame.tracks[i];          // ids: frame.trackIds[i]
      // ch.peakL / ch.peakR, ch.peakHoldL / ch.peakHoldR, ch.rmsL / ch.rmsR  (all dBFS)
      // ch.gainReductionDb (positive dB)
    }
    // frame.returnA, frame.returnB, frame.master (same ChannelMeter shape)
    // frame.safetyLimiterGainReductionDb, frame.positionSec
  });
  return <canvas ref={canvas} />;
}
```

`useDawMeters(cb)` runs a `requestAnimationFrame` loop while mounted. Without a callback it only hands back stable getters so you can run your own loop. `getMeterFrame()` allocates nothing, so you can call it from several canvases per frame.

Per-plugin readouts (VU needle, GR meter in the device rack):

```ts
const out: PluginMeterReadout = { gainReductionDb: 0, vuDb: -120 };   // allocate once
if (getPluginMeters(trackId, instanceId, out)) draw(out.gainReductionDb, out.vuDb);
```

The playhead is also not in the snapshot: read `getPositionSec()` in the same rAF loop.

## 4. UI bindings (Ableton Live layout)

### 4.1 Top transport bar

| Control | Binding |
| --- | --- |
| Play / Pause | `togglePlay()`; state: `snapshot.transport.playing` |
| Stop (return to 0) | `stop()` |
| Position display | `getPositionSec()` in rAF |
| Click on ruler / scrub | `seek(sec)` |
| Loop brace + toggle | `setLoop(startSec, endSec, enabled)`; state: `transport.loopEnabled/loopStartSec/loopEndSec` |
| Project length | `transport.durationSec` |
| Project name | `renameProject(name)`; `snapshot.project.name` |
| Save indicator | `snapshot.autosave.status`: `'idle' \| 'saving' \| 'saved' \| 'error'`, plus `dirty`, `lastSavedAt`, `error` |
| Master meter | `frame.master` and `frame.safetyLimiterGainReductionDb` |
| Export | `exportMixdownWav({ bitDepth: 24 })`; progress in `snapshot.export.progress` (0..1), `status` |
| Send to analyzer | `sendMixdownToAnalyzer()` (see §6) |

Drop zone for audio: `importFile(file)` accepts wav / mp3 / flac / ogg. It creates the track, decodes, computes peaks and caches the blob in IndexedDB. Errors reject with `DawImportError` and also appear in `snapshot.error`.

### 4.2 Left Plugin Browser

`PLUGIN_CATEGORIES` is the ordered list of group names (Compressors, Equalizers, Tape Machines, Spatial, Utilities). `PLUGIN_REGISTRY` is keyed by category.

```tsx
{PLUGIN_CATEGORIES.map((cat) => (
  <Group key={cat} title={cat}>
    {PLUGIN_REGISTRY[cat].map((entry) => (
      <Item
        key={entry.id}
        title={entry.descriptor.name}
        subtitle={entry.descriptor.description}
        // drag the id; on drop call addPlugin(targetChainId, entry.id, dropIndex)
        draggable data-plugin-id={entry.id}
      />
    ))}
  </Group>
))}
```

Double-click / "load" on the selected track: `addPlugin(selectedTrackId, pluginId)`. For the Master, use `addPlugin('master', pluginId)`; for returns, `'returnA'` (reverb) and `'returnB'` (delay).

### 4.3 Arrangement ⇄ Mixer toggle

This is pure UI state; the engine does not care. Both views read the same `ProjectState`.

- **Arrangement view:** one row per `project.tracks[i]`. Waveform from `track.peaks` (max absolute amplitude 0..1 per bucket, `PEAKS_RESOLUTION` buckets); file info in `track.audio`. Clip geometry from `track.clip` (`startSec`, `trimStartSec`, `trimEndSec`); edit with `setTrackClip(id, { ... })`. Reorder with `moveTrack(id, toIndex)` or `reorderTracks(ids)`. Rename with `renameTrack`.
- **Mixer view:** one strip per track, then Return A, Return B, Master:

| Strip element | Binding |
| --- | --- |
| Input gain knob (±24 dB) | `setTrackInputGain(id, db)` |
| Ø button | `setTrackPhaseInvert(id, bool)` |
| Send A / Send B knobs | `setTrackSend(id, 'A' \| 'B', 0..1)` |
| Pan | `setTrackPan(id, -1..1)` |
| Fader | `setTrackFader(id, db)` (−100 = −∞) |
| M / S | `setTrackMute(id, bool)` / `setTrackSolo(id, bool)`; `anySolo` from `useDawProject()` |
| Meter | `frame.tracks[i]` where `frame.trackIds[i] === id` |
| Return A / B fader, mute | `setReturnFader('returnA' \| 'returnB', db)`, `setReturnMute(...)` |
| Master fader | `setMasterFader(db)` |
| Missing-audio badge | `snapshot.missingAudioTrackIds.includes(id)` → show "Relink", call `relinkTrackAudio(id, file)` |

Mute, solo, bypass and every toggle are click-free (15 ms ramps), so you can bind them to rapid clicks.

### 4.4 Bottom horizontal Device Rack

The rack shows the chain of the selected track (or `'master'`, `'returnA'`, `'returnB'`). `getChain` gives you the ordered plugin states:

```ts
const chain: PluginState[] =
  selected === 'master' ? project.master.inserts
  : selected === 'returnA' ? project.returnA.inserts
  : selected === 'returnB' ? project.returnB.inserts
  : project.tracks.find(t => t.id === selected)!.inserts;
```

For each `PluginState` (`instanceId`, `pluginId`, `bypass`, `deltaListen`, `inputTrimDb`, `outputTrimDb`, `abSlot`, `paramsA`, `paramsB`, `presetId`):

| Device header control | Binding |
| --- | --- |
| Power / bypass | `setPluginBypass(chainId, instanceId, bool)` |
| A/B switch | `togglePluginAB(chainId, instanceId)` (returns the active slot) |
| Copy A→B | `copyPluginAToB(chainId, instanceId)` |
| Delta listen (Δ) | `setPluginDeltaListen(chainId, instanceId, bool)` |
| Input trim / Output trim | `setPluginInputTrim` / `setPluginOutputTrim` (dB, ±24) |
| Preset menu | `getPluginDescriptor(pluginId).presets` → `loadPluginPreset(chainId, instanceId, presetId)` |
| Remove | `removePlugin(chainId, instanceId)` |
| Reorder (drag) | `movePlugin(chainId, instanceId, toIndex)` |
| GR / VU meter | `getPluginMeters(chainId, instanceId, out)` in rAF |

Parameters are described by data, so one generic knob/slider/switch component renders all 16 devices:

```ts
const desc: PluginDescriptor = getPluginDescriptor(plugin.pluginId);
for (const p of desc.params) {
  // p.id, p.label, p.min, p.max, p.default, p.unit ('dB' | 'Hz' | 'ms' | 's' | '%' | 'ratio' | 'oct' | 'Q' | 'x' | 'none' | 'enum' | 'bool'),
  // p.curve ('linear' | 'log' | 'stepped' | 'toggle'), p.options (labelled choices for 'stepped'), p.step, p.group, p.decimals
  const value = (plugin.abSlot === 'A' ? plugin.paramsA : plugin.paramsB)[p.id] ?? p.default;
  // on change: setPluginParam(chainId, plugin.instanceId, p.id, newValue)  // returns the clamped value applied
}
```

Use `paramToNormalized(p, value)` and `normalizedToParam(p, n)` to map a 0..1 knob angle to the right curve. `setPluginParam` always clamps, so the UI can never push a plugin out of range.

## 5. Project lifecycle

| UI action | Call |
| --- | --- |
| "New project" | `await newProject('Name')` |
| Project list / open dialog | `const list = await listProjects()` then `await openProject(id)` |
| "Save" | `await saveNow()`. Auto-save already runs 2 s after the last edit. |
| "Duplicate" | `await duplicateProject(id?, newName?)` |
| "Delete" | `await deleteProject(id)` (if it is the open project, a fresh empty one is loaded) |

Opening a project loads the JSON, rebuilds the whole graph, then re-attaches each track's audio from IndexedDB. Tracks whose blob is not on this device (another browser, cleared storage) appear in `snapshot.missingAudioTrackIds`. They stay in the mix, silent, with all settings intact, until you call `relinkTrackAudio(trackId, file)`.

`ProjectState` is plain JSON (`serializeProject` / `deserializeProject`), stored in the `project_state` jsonb column. It never contains audio data, only references and peaks.

## 6. Connecting the export to the MixLearn Studio analyzer

`exportMixdownWav()` rebuilds the full graph (tracks, inserts, sends, returns, master chain, safety limiter) in an `OfflineAudioContext`, faster than real time, and encodes 16- or 24-bit PCM WAV with TPDF dither.

```ts
const result = await exportMixdownWav({ bitDepth: 24, tailSec: 2 /* optional, default auto */ });
result.blob       // Blob (audio/wav)
result.file       // File, ready for onSendToAnalyzer
result.fileName, result.peakDb, result.clippedSamples, result.durationSec, result.sampleRate, result.bitDepth
```

Wire the analyzer once at app start; then any button can send:

```ts
const daw = useDawController({
  onSendToAnalyzer: async (wavFile: File) => {
    await analyzerClient.loadFile(wavFile);     // MixLearn Studio entry point
    navigate('/studio/analyzer');
  },
});

<button onClick={() => daw.sendMixdownToAnalyzer()}>Send to Analyzer</button>
```

`sendMixdownToAnalyzer()` renders at 24-bit by default and calls the callback with the `File`. If no callback was registered it rejects with a clear error (and sets `snapshot.error`). To also offer a download, call `triggerDownload(result.blob, result.file.name)`.

## 7. Errors & edge cases

- Every rejecting action also writes a message to `snapshot.error`. Show it in a toast and call `clearError()`.
- `snapshot.ready === false` until the AudioContext and worklets are initialised: disable transport until then.
- If `AudioWorklet` is unavailable the engine rejects `init()` with `DawWorkletUnavailableError`; show "needs HTTPS / modern browser".
- The page-hide handler flushes pending auto-save automatically; no UI work needed.

## 8. Package checklist

```bash
npm install
npm run typecheck     # tsc --noEmit, must be 0 errors
npm test              # vitest: DSP render tests, param bounds, project JSON, WAV headers, storage
npm run build         # emits dist/
```
