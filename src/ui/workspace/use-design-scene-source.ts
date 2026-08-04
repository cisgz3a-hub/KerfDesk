// The CNC pane's design-time scene source, with the same page-backed
// escalation the 2D preview already has.
//
// computeDesignSceneSource is synchronous, and previewPreparationIssue reports
// `too-complex` for a page-backed project because no synchronous caller can
// read pixels out of IndexedDB. buildPreviewToolpathSnapshot recovers by
// awaiting hydratePagedRasterProject first; the pane had no such path, so a
// project holding a large PNG showed an empty 3D pane forever. Hydrate here so
// the pane is judged on the same embedded geometry the 2D preview sees.
import { useEffect, useState } from 'react';
import type { OutputScope, Project } from '../../core/scene';
import {
  hydratePagedRasterProject,
  projectHasPagedRasterAssets,
} from '../import/paged-raster-hydration';
import { computeDesignSceneSource } from './design-scene-source';
import {
  computeDesignSceneSourceOffThread,
  isDesignSceneSuperseded,
} from './design-scene-worker-client';
import type { DesignSceneSource } from './use-cnc-3d-scene';
import { costlyCanvasPreparation } from './canvas-preparation-policy';

// Matches the layers panel's F-A7 advisory cadence: long enough that dragging a
// slider or stepping through bits builds once at rest, short enough that the
// pane still feels tied to the edit.
const SOURCE_DEBOUNCE_MS = 250;

/** Removal grid, 3D moves, and bit silhouette for the CNC pane, hydrating page-backed rasters. */
export function useDesignSceneSource(
  project: Project,
  outputScope: OutputScope,
  collapsed: boolean,
): DesignSceneSource | null {
  const [source, setSource] = useState<DesignSceneSource | null>(null);

  // This used to be a render-path useMemo, which put a full prepareOutput plus
  // removal grid in front of every paint: React could not draw until it
  // finished, and each settings change started a fresh build with no
  // coalescing. Invisible while CNC compiles were milliseconds, fatal once a
  // V-carve layer made them cost seconds (vcarveMedialPasses, ADR-285) —
  // selecting the cut type or changing the bit froze the whole app.
  //
  // The build now runs in the pane's own worker, so it cannot delay anything
  // else the app is doing, and the debounce collapses a burst of bit changes
  // into one request. The previous grid stays on screen while the next one
  // builds, so the pane never blanks mid-edit.
  useEffect(() => {
    if (collapsed) {
      setSource(null);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const offThread = computeDesignSceneSourceOffThread(project, outputScope);
      if (offThread !== null) {
        void offThread
          .then((next) => {
            if (!cancelled) setSource(next);
          })
          .catch((err: unknown) => {
            // A superseded request is the normal outcome of typing; only a real
            // failure should clear the pane.
            if (cancelled || isDesignSceneSuperseded(err)) return;
            setSource(null);
          });
        return;
      }
      if (costlyCanvasPreparation(project, outputScope)) {
        // Display-only pane: retain no stale source when the required worker
        // is unavailable. Never move a costly compile onto the UI thread.
        setSource(null);
        return;
      }
      // No Worker (vitest/jsdom): keep the previous on-thread behaviour, page
      // -backed rasters included — their pixels live in IndexedDB, which a
      // synchronous compute cannot read for itself.
      if (projectHasPagedRasterAssets(project)) {
        void hydratePagedRasterProject(project)
          .then((hydrated) => {
            if (!cancelled) setSource(computeDesignSceneSource(hydrated, outputScope));
          })
          .catch(() => {
            // The pane simply stays empty; the 2D preview surfaces the read failure.
            if (!cancelled) setSource(null);
          });
        return;
      }
      setSource(computeDesignSceneSource(project, outputScope));
    }, SOURCE_DEBOUNCE_MS);
    return (): void => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project, outputScope, collapsed]);

  return source;
}
