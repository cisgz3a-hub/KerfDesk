// Image/raster store actions — thin dispatchers wiring the pure scene
// mutations into Zustand `set` calls: bitmap import (importRasterImage)
// and the ADR-026 trace-on-selection tool (traceExistingImage). Split
// out of store.ts so that file stays under the 400-line hard cap.
//
// Mirrors the viewport-actions.ts no-cycle pattern: restates the
// minimal `set` / `get` shapes (ImportSet / ProjectSlice) it needs
// rather than importing AppState from store.ts, which would form the
// store.ts -> import-actions.ts -> store.ts cycle ESLint forbids.

import type { SceneObject, TracedImage } from '../../core/scene';
import {
  applyFreshImport,
  applyTraceToExisting,
  type MutationResult,
  type StateSlice,
} from './scene-mutations';
import { fitAllObjects, type ProjectSlice } from './viewport-actions';

// Narrow `set`: every action here dispatches a pure mutation helper
// returning a MutationResult. AppState's full Setter is assignable to
// this (MutationResult is a subset of Partial<AppState>, and AppState
// is a subset of StateSlice), so store.ts passes its own `set` through
// unchanged.
type ImportSet = (fn: (s: StateSlice) => MutationResult) => void;

export function imageImportActions(
  set: ImportSet,
  get: () => ProjectSlice,
): {
  readonly importRasterImage: (object: SceneObject) => void;
  readonly traceExistingImage: (sourceId: string, traced: TracedImage) => void;
} {
  return {
    importRasterImage: (object) => {
      set((s) => applyFreshImport(s, object, 0));
      // Auto-zoom to fit all objects — see viewport-actions.fitAllObjects.
      fitAllObjects(get);
    },
    traceExistingImage: (sourceId, traced) => {
      set((s) => applyTraceToExisting(s, sourceId, traced));
      fitAllObjects(get);
    },
  };
}
