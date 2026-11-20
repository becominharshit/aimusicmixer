import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { MasterState, ProjectState, ReturnState, TrackState } from '../types';
import { type DawController, getDefaultDawController } from '../controller/DawController';

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Subscribe to a slice of the project. The component re-renders only when the selected value changes
 * (compared with `isEqual`, `Object.is` by default; pass `shallowEqual` for object/array results).
 */
export function useDawProjectSelector<T>(
  selector: (project: ProjectState) => T,
  controller: DawController = getDefaultDawController(),
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cache = useRef<{ project: ProjectState; selector: (p: ProjectState) => T; value: T } | null>(null);
  const getSnapshot = useCallback((): T => {
    const project = controller.getSnapshot().project;
    const c = cache.current;
    if (c && c.project === project && c.selector === selector) return c.value;
    const next = selector(project);
    if (c && isEqual(c.value, next)) {
      cache.current = { project, selector, value: c.value };
      return c.value;
    }
    cache.current = { project, selector, value: next };
    return next;
  }, [controller, selector, isEqual]);
  return useSyncExternalStore(controller.subscribe, getSnapshot, getSnapshot);
}

export interface DawProjectView {
  project: ProjectState;
  tracks: TrackState[];
  returnA: ReturnState;
  returnB: ReturnState;
  master: MasterState;
  /** `true` when any track is soloed (non-soloed tracks are silenced). */
  anySolo: boolean;
  projectName: string;
}

/** The whole project, with convenient pre-split parts. Re-renders on every project change. */
export function useDawProject(controller: DawController = getDefaultDawController()): DawProjectView {
  const project = useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot().project,
    () => controller.getSnapshot().project,
  );
  return useMemo(
    () => ({
      project,
      tracks: project.tracks,
      returnA: project.returnA,
      returnB: project.returnB,
      master: project.master,
      anySolo: project.tracks.some((t) => t.solo),
      projectName: project.name,
    }),
    [project],
  );
}
