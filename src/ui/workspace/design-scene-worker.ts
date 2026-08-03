// CNC 3D carve pane worker.
//
// Runs prepareOutput + the removal grid away from the React thread. The pane
// used to build this inside a render-path useMemo, so a V-carve layer — which
// costs seconds on the current engine (vcarveMedialPasses, ADR-285) — froze
// the whole app whenever the cut type or bit changed.
//
// This is its own worker rather than a second consumer of the ADR-244
// preparation worker: the 3D grid is the most expensive and least urgent thing
// the app builds, so it must never make the 2D preview or the ETA badge wait
// behind it.
//
// Vite bundles this via the direct
// `new Worker(new URL('./design-scene-worker.ts', import.meta.url), { type: 'module' })`
// call in design-scene-worker-client.ts.

/// <reference lib="webworker" />

import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import { computeDesignSceneSource } from './design-scene-source';
import type {
  DesignSceneWorkerRequest,
  DesignSceneWorkerResponse,
} from './design-scene-worker-protocol';

self.onmessage = async (e: MessageEvent<DesignSceneWorkerRequest>): Promise<void> => {
  const { id, project, outputScope } = e.data;
  try {
    // Hydrate here for the same reason the 2D path does: a page-backed raster
    // keeps its pixels in IndexedDB, and computeDesignSceneSource is
    // synchronous so it cannot fetch them itself.
    const hydrated = await hydratePagedRasterProject(project);
    const response: DesignSceneWorkerResponse = {
      id,
      kind: 'ok',
      source: computeDesignSceneSource(hydrated, outputScope),
    };
    self.postMessage(response);
  } catch (err) {
    const response: DesignSceneWorkerResponse = {
      id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
