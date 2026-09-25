// barcode-insert-mutation — commits a generated barcode (ADR-386). A new code
// lands centred on the bed, unscaled, on its own Fill operation: only filled
// modules scan, so the operation stays Fill even when the operator's layer
// defaults would start it as a line. Editing replaces the code in place and
// keeps its placement, bindings and per-object settings. One undo step each.

import { isBarcodeObject } from '../../core/barcode';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  fitObjectToBed,
  replaceObject,
  type ShapeObject,
} from '../../core/scene';
import type { CncLiveCapsState } from './cnc-live-caps-actions';
import type { LayerDefaultsState } from './layer-default-actions';
import { applyLayerDefaultsToFreshLayers } from './object-insert-actions';
import { pushUndo, type MutationResult, type StateSlice } from './scene-mutations';

type BarcodeInsertState = StateSlice & {
  readonly layerDefaults: LayerDefaultsState;
  readonly cncLiveCaps: CncLiveCapsState['cncLiveCaps'];
};

export type BarcodeInsertResult = MutationResult & {
  readonly additionalSelectedIds: ReadonlySet<string>;
};

export function applyInsertBarcode(
  s: BarcodeInsertState,
  object: ShapeObject,
): BarcodeInsertResult {
  const { bedWidth, bedHeight } = s.project.device;
  const created = createArtworkOperation(s.project.scene, object, { mode: 'fill' });
  const placed = fitObjectToBed(created.object, bedWidth, bedHeight, 'center-only');
  const inserted: BarcodeInsertResult = {
    project: {
      ...s.project,
      scene: addLayer(addObject(s.project.scene, placed), created.operation),
    },
    selectedObjectId: object.id,
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
  const defaulted = applyLayerDefaultsToFreshLayers(
    s.project.scene.layers,
    inserted,
    s.layerDefaults,
    s.cncLiveCaps,
  );
  const layers = defaulted.project.scene.layers.map((layer) =>
    layer.id === created.operation.id ? { ...layer, mode: 'fill' as const } : layer,
  );
  return {
    ...defaulted,
    project: { ...defaulted.project, scene: { ...defaulted.project.scene, layers } },
  };
}

/** Null when the target is gone, locked or no longer a barcode. */
export function applyReplaceBarcode(s: StateSlice, next: ShapeObject): MutationResult | null {
  const existing = s.project.scene.objects.find((object) => object.id === next.id);
  if (existing === undefined || !isBarcodeObject(existing) || existing.locked === true) {
    return null;
  }
  const replacement: ShapeObject = {
    ...existing,
    spec: next.spec,
    bounds: next.bounds,
    paths: next.paths.map((path, index) => {
      const operationIds = existing.paths[index]?.operationIds;
      return operationIds === undefined ? path : { ...path, operationIds };
    }),
  };
  return {
    project: { ...s.project, scene: replaceObject(s.project.scene, next.id, replacement) },
    selectedObjectId: next.id,
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}
