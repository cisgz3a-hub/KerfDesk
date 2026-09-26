// Image/raster store actions — thin dispatchers wiring the pure scene
// mutations into Zustand `set` calls: bitmap import (importRasterImage),
// the ADR-026 trace-on-selection tool (traceExistingImage), and ADR-029
// Convert to Bitmap (convertToBitmap). Split out of store.ts so that file
// stays under the 400-line hard cap.
//
// Mirrors the viewport-actions.ts no-cycle pattern: restates the
// minimal `set` / `get` shapes (ImportSet / ProjectSlice) it needs
// rather than importing AppState from store.ts, which would form the
// store.ts -> import-actions.ts -> store.ts cycle ESLint forbids.

import type { RasterImage, SceneObject, TracedImage } from '../../core/scene';
import { applyConvertToBitmap } from './convert-to-bitmap';
import { applyRasterizedTraceToExisting } from './rasterized-trace-mutation';
import {
  applyFreshImport,
  applyTraceToExisting,
  type ImportOutcome,
  type MutationResult,
  type StateSlice,
  type TraceExistingImageOptions,
} from './scene-mutations';
import { applyImportBedFit } from './import-bed-fit';
import { fitAllObjects, type ProjectSlice } from './viewport-actions';
import { projectWithFreshCncLayers } from './cnc-auto-seeding';
import type { CncLiveCapsState } from './cnc-live-caps-actions';
import type { LayerDefaultsState } from './layer-default-actions';
import { applyCameraTraceImport } from './camera-trace-import';

// Narrow `set`: every action here dispatches a pure mutation helper
// returning a MutationResult. AppState's full Setter is assignable to
// this (MutationResult is a subset of Partial<AppState>, and AppState
// is a subset of StateSlice), so store.ts passes its own `set` through
// unchanged.
type ImportState = StateSlice &
  Partial<CncLiveCapsState> & {
    readonly layerDefaults?: LayerDefaultsState;
  };
type ImportSet = (fn: (s: ImportState) => MutationResult) => void;

export function imageImportActions(
  set: ImportSet,
  get: () => ProjectSlice,
): {
  readonly importRasterImage: (object: SceneObject, batchIdx?: number) => ImportOutcome;
  readonly traceExistingImage: (
    sourceId: string,
    traced: TracedImage,
    options?: TraceExistingImageOptions,
  ) => void;
  readonly commitRasterizedTrace: (
    sourceId: string,
    raster: RasterImage,
    options?: TraceExistingImageOptions,
  ) => void;
  readonly convertToBitmap: (sourceIds: ReadonlyArray<string>, raster: RasterImage) => void;
} {
  return {
    importRasterImage: (object, batchIdx) => {
      let outcome: ImportOutcome = { kind: 'added' };
      // batchIdx staggers multi-image drops by 10 mm each (F-A3); a single
      // import or the toolbar picker passes nothing → 0.
      set((s) => {
        const fitted = applyImportBedFit(
          withFreshCncLayers(s, applyFreshImport(s, object, batchIdx ?? 0)),
        );
        outcome = fitted.outcome;
        return fitted.state;
      });
      // Auto-zoom to fit all objects — see viewport-actions.fitAllObjects.
      fitAllObjects(get);
      return outcome;
    },
    traceExistingImage: (sourceId, traced, options) => {
      set((s) =>
        withFreshCncLayers(
          s,
          options?.cameraSource === undefined
            ? applyTraceToExisting(s, sourceId, traced, options)
            : applyCameraTraceImport(s, options.cameraSource, traced, options),
        ),
      );
      fitAllObjects(get);
    },
    // Rasterized traces retain the source's placement and Image operation, so
    // committing them is an in-place swap and must not move the viewport.
    commitRasterizedTrace: (sourceId, raster, options) => {
      set((s) =>
        withFreshCncLayers(
          s,
          options?.cameraSource === undefined
            ? applyRasterizedTraceToExisting(s, sourceId, raster, options)
            : applyCameraTraceImport(s, options.cameraSource, raster, options),
        ),
      );
    },
    // No fitAllObjects: Convert replaces the vector(s) in place (same combined
    // bounds), so re-fitting would only jerk the camera. Consistent with the
    // store convention that the import/add paths re-fit, not in-place edits.
    convertToBitmap: (sourceIds, raster) => {
      set((s) => withFreshCncLayers(s, applyConvertToBitmap(s, sourceIds, raster)));
    },
  };
}

function withFreshCncLayers(state: ImportState, result: MutationResult): MutationResult {
  // Laser Make Default never carries CNC settings, so every new CNC operation
  // from an import or trace is seeded from the machine setup.
  return {
    ...result,
    project: projectWithFreshCncLayers(
      state.project.scene.layers,
      result.project,
      state.cncLiveCaps ?? null,
    ),
  };
}
