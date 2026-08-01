// The CNC pane's design-time scene source, with the same page-backed
// escalation the 2D preview already has.
//
// computeDesignSceneSource is synchronous, and previewPreparationIssue reports
// `too-complex` for a page-backed project because no synchronous caller can
// read pixels out of IndexedDB. buildPreviewToolpathSnapshot recovers by
// awaiting hydratePagedRasterProject first; the pane had no such path, so a
// project holding a large PNG showed an empty 3D pane forever. Hydrate here so
// the pane is judged on the same embedded geometry the 2D preview sees.
import { useEffect, useMemo, useState } from 'react';
import type { OutputScope, Project } from '../../core/scene';
import {
  hydratePagedRasterProject,
  projectHasPagedRasterAssets,
} from '../import/paged-raster-hydration';
import { computeDesignSceneSource } from './design-scene-source';
import type { DesignSceneSource } from './use-cnc-3d-scene';

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

  // Embedded projects keep the synchronous path so typing stays snappy and
  // hover stays value-stable (PRF-01).
  const embeddedSource = useMemo(
    () => (collapsed || isPageBacked ? null : computeDesignSceneSource(project, outputScope)),
    [project, outputScope, collapsed, isPageBacked],
  );

  return isPageBacked ? hydratedSource : embeddedSource;
}
