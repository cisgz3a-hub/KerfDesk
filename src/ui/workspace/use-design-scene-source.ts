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
import type { DesignSceneSource } from './use-cnc-3d-scene';

// Matches the layers panel's F-A7 advisory cadence: long enough that dragging a
// slider or stepping through bits builds once at rest, short enough that the
// pane still feels tied to the edit.
const EMBEDDED_SOURCE_DEBOUNCE_MS = 250;

/** Removal grid, 3D moves, and bit silhouette for the CNC pane, hydrating page-backed rasters. */
export function useDesignSceneSource(
  project: Project,
  outputScope: OutputScope,
  collapsed: boolean,
): DesignSceneSource | null {
  const isPageBacked = projectHasPagedRasterAssets(project);
  const [hydratedSource, setHydratedSource] = useState<DesignSceneSource | null>(null);

  useEffect(() => {
    if (collapsed || !isPageBacked) {
      setHydratedSource(null);
      return;
    }
    let cancelled = false;
    void hydratePagedRasterProject(project)
      .then((hydrated) => {
        if (!cancelled) setHydratedSource(computeDesignSceneSource(hydrated, outputScope));
      })
      .catch(() => {
        // The pane simply stays empty; the 2D preview surfaces the read failure.
        if (!cancelled) setHydratedSource(null);
      });
    return (): void => {
      cancelled = true;
    };
  }, [project, outputScope, collapsed, isPageBacked]);

  // Embedded projects used to compute here in a useMemo, which put a full
  // prepareOutput + removal grid on the render path: React could not paint
  // until it finished, and every settings change started a fresh one with no
  // coalescing. That was invisible while CNC compiles were milliseconds, but a
  // V-carve layer costs seconds (vcarveMedialPasses, ADR-285), so selecting the
  // cut type or changing the bit froze the app.
  //
  // Debouncing in an effect keeps the compile off the render path and collapses
  // a burst of changes into one build. The previous grid stays on screen while
  // the next one computes, so the pane never blanks. The compile itself is
  // still synchronous once it runs — moving it onto the ADR-244 worker is the
  // remaining work.
  const [embeddedSource, setEmbeddedSource] = useState<DesignSceneSource | null>(null);

  useEffect(() => {
    if (collapsed || isPageBacked) {
      setEmbeddedSource(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setEmbeddedSource(computeDesignSceneSource(project, outputScope));
    }, EMBEDDED_SOURCE_DEBOUNCE_MS);
    return (): void => {
      window.clearTimeout(timer);
    };
  }, [project, outputScope, collapsed, isPageBacked]);

  return isPageBacked ? hydratedSource : embeddedSource;
}
