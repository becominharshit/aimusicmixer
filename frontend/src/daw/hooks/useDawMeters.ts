import { useEffect, useMemo, useRef } from 'react';
import type { MeterFrame } from '../types';
import { type DawController, getDefaultDawController } from '../controller/DawController';

export interface UseDawMetersResult {
  /** Fills and returns one shared telemetry object. Zero allocation: call it as often as you like. */
  getMeterFrame: DawController['getMeterFrame'];
  getPositionSec: DawController['getPositionSec'];
  getPluginMeters: DawController['getPluginMeters'];
  resetPeakHolds: DawController['resetPeakHolds'];
}

/**
 * Metering without React state. The returned functions are referentially stable and never cause a re-render.
 *
 * Optionally pass `onFrame` to run a `requestAnimationFrame` loop for the lifetime of the component; the callback
 * receives the shared `MeterFrame` (do not keep it) and should draw directly to a `<canvas>`.
 */
export function useDawMeters(
  onFrame?: (frame: MeterFrame) => void,
  controller: DawController = getDefaultDawController(),
): UseDawMetersResult {
  const callback = useRef(onFrame);
  callback.current = onFrame;
  const enabled = onFrame !== undefined;

  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame === 'undefined') return;
    let raf = 0;
    const loop = () => {
      const cb = callback.current;
      if (cb) cb(controller.getMeterFrame());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [controller, enabled]);

  return useMemo(
    () => ({
      getMeterFrame: controller.actions.getMeterFrame,
      getPositionSec: controller.actions.getPositionSec,
      getPluginMeters: controller.actions.getPluginMeters,
      resetPeakHolds: controller.actions.resetPeakHolds,
    }),
    [controller],
  );
}
