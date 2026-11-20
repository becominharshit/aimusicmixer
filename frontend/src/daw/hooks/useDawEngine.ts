import { useMemo, useSyncExternalStore } from 'react';
import { type DawController, getDefaultDawController } from '../controller/DawController';
import type { DawAudioEngine, TransportSnapshot } from '../engine/DawAudioEngine';

export interface UseDawEngineResult {
  engine: DawAudioEngine;
  /** AudioContext created and DSP worklets loaded. */
  ready: boolean;
  /** `playing`, loop region and total duration. The playhead is NOT included: use `getPositionSec()` in rAF. */
  transport: TransportSnapshot;
  play: DawController['play'];
  pause: DawController['pause'];
  stop: DawController['stop'];
  togglePlay: DawController['togglePlay'];
  seek: DawController['seek'];
  setLoop: DawController['setLoop'];
  getPositionSec: DawController['getPositionSec'];
}

/** Transport-focused view of the engine for the top transport bar. */
export function useDawEngine(controller: DawController = getDefaultDawController()): UseDawEngineResult {
  const ready = useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot().ready,
    () => false,
  );
  const transport = useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot().transport,
    () => controller.getSnapshot().transport,
  );
  return useMemo(
    () => ({
      engine: controller.engine,
      ready,
      transport,
      play: controller.actions.play,
      pause: controller.actions.pause,
      stop: controller.actions.stop,
      togglePlay: controller.actions.togglePlay,
      seek: controller.actions.seek,
      setLoop: controller.actions.setLoop,
      getPositionSec: controller.actions.getPositionSec,
    }),
    [controller, ready, transport],
  );
}
