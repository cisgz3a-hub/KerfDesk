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
  type MutationResult,
  type StateSlice,
  type TraceExistingImageOptions,
} from './scene-mutations';
import { fitAllObjects, type ProjectSlice } from './viewport-actions';
import { projectWithFreshCncLayers } from './cnc-auto-seeding';
import type { CncLiveCapsState } from './cnc-live-caps-actions';
import {
  DEFAULT_LAYER_DEFAULTS_STATE,
  defaultSettingsForColor,
  type LayerDefaultsState,
} from './layer-default-actions';
import { sourceColorForOperation } from './operation-source-color';

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
  readonly importRasterImage: (object: SceneObject, batchIdx?: number) => void;
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
      // batchIdx staggers multi-image drops by 10 mm each (F-A3); a single
      // import or the toolbar picker passes nothing → 0.
      set((s) => withFreshCncLayers(s, applyFreshImport(s, object, batchIdx ?? 0)));
      // Auto-zoom to fit all objects — see viewport-actions.fitAllObjects.
      fitAllObjects(get);
    },
    traceExistingImage: (sourceId, traced, options) => {
      set((s) => withFreshCncLayers(s, applyTraceToExisting(s, sourceId, traced, options)));
      fitAllObjects(get);
    },
    // Rasterized traces retain the source's placement and Image operation, so
    // committing them is an in-place swap and must not move the viewport.
    commitRasterizedTrace: (sourceId, raster, options) => {
      set((s) =>
        withFreshCncLayers(s, applyRasterizedTraceToExisting(s, sourceId, raster, options)),
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
  const existingIds = new Set(state.project.scene.layers.map((layer) => layer.id));
  const savedDefaultLayerIds = new Set<string>();
  const defaults = state.layerDefaults ?? DEFAULT_LAYER_DEFAULTS_STATE;
  const layers = result.project.scene.layers.map((layer) => {
    if (existingIds.has(layer.id)) return layer;
    const sourceColor = sourceColorForOperation(result.project.scene.objects, layer) ?? layer.color;
    const savedCnc = defaultSettingsForColor(defaults, sourceColor).cnc;
    if (savedCnc === undefined) return layer;
    savedDefaultLayerIds.add(layer.id);
    // Image and trace mutations own structural settings such as mode and
    // density. Only the operator's saved CNC block participates here.
    return { ...layer, cnc: savedCnc };
  });
  const project = layers.some((layer, index) => layer !== result.project.scene.layers[index])
    ? { ...result.project, scene: { ...result.project.scene, layers } }
    : result.project;
  return {
    ...result,
    project: projectWithFreshCncLayers(
      state.project.scene.layers,
      project,
      state.cncLiveCaps ?? null,
      savedDefaultLayerIds,
    ),
  };
}
