import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  type DawActions,
  DawController,
  type DawControllerOptions,
  type DawSnapshot,
  getDefaultDawController,
} from '../controller/DawController';

export interface UseDawControllerOptions extends DawControllerOptions {
  /** Use an existing controller instead of the shared default one. */
  controller?: DawController;
  /** Call `controller.init()` on mount (creates the AudioContext, loads DSP worklets). Default true. */
  autoInit?: boolean;
  /** Open this saved project right after init. */
  projectId?: string;
}

export interface UseDawControllerResult extends DawActions {
  controller: DawController;
  /** Immutable snapshot: project state, transport, auto-save status, export status, missing audio. */
  snapshot: DawSnapshot;
}

/**
 * The one hook that exposes every Ableton-workflow action (transport, tracks, mixer, device rack, project
 * new/open/auto-save, WAV export, `onSendToAnalyzer`). Built on `useSyncExternalStore`, so components re-render only
 * when the snapshot reference changes. Meters and playhead are NOT part of the snapshot: poll `getMeterFrame()` and
 * `getPositionSec()` from `requestAnimationFrame` (see `useDawMeters`).
 */
export function useDawController(options: UseDawControllerOptions = {}): UseDawControllerResult {
  const { controller: provided, autoInit = true, projectId, ...controllerOptions } = options;
  const controller = provided ?? getDefaultDawController(controllerOptions);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    if (!autoInit) return;
    controller.init(projectId).catch(() => {
      /* surfaced through snapshot.error */
    });
  }, [controller, autoInit, projectId]);

  return useMemo(() => ({ ...controller.actions, controller, snapshot }), [controller, snapshot]);
}
