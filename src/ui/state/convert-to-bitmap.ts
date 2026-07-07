// ADR-029 Convert to Bitmap — the pure scene mutation that swaps the selected
// vector object(s) for the RasterImage rasterized from them.
//
// This is the LightBurn-faithful INVERSE of Trace: where applyTraceToExisting
// (ADR-026) KEEPS the source bitmap behind the new vector, Convert to Bitmap
// DELETES the source vectors (LightBurn discards the originals — it warns and
// suggests duplicating first). The asymmetry is intentional and ADR-justified.
// A multi-selection merges into ONE bitmap (ADR-029 amendment ii), so every
// source in the selection is removed in the same single undo entry.
//
// Division of labour: the UI builds the RasterImage (canvas PNG encode + luma
// extraction are DOM/browser work, and the new id is minted there) carrying
// the selection's combined baked bounds, so the bitmap lands exactly where
// the vectors were. This helper does only the pure, deterministic scene
// transform — drop the sources, add the raster on a fresh image-mode layer,
// prune the sources' now-orphaned color layers, and record a single undo
// entry — so it unit-tests without a DOM, like every other helper in
// scene-mutations.
//
// Total + defensive: if a sourceId no longer resolves (shouldn't happen — the
// Convert button is gated on a live convertible selection), the raster is
// still added rather than silently lost, mirroring applyTraceToExisting's
// missing-source fallback.

import { addObject, type RasterImage, removeObject } from '../../core/scene';
import {
  ensureRasterImageLayer,
  resolveRasterLayerColor,
  type MutationResult,
  pruneOrphanLayers,
  pushUndo,
  type StateSlice,
} from './scene-mutations';

export function applyConvertToBitmap(
  s: StateSlice,
  sourceIds: ReadonlyArray<string>,
  raster: RasterImage,
): MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> } {
  let scene = s.project.scene;
  const color = resolveRasterLayerColor(scene, raster.color, raster.linesPerMm);
  const converted = color === raster.color ? raster : { ...raster, color };
  for (const sourceId of sourceIds) {
    if (scene.objects.some((o) => o.id === sourceId)) {
      scene = removeObject(scene, sourceId);
    }
  }
  scene = addObject(scene, converted);
  scene = ensureRasterImageLayer(scene, converted.color, converted.linesPerMm);
  // Drop the source vectors' color layers if nothing else references them —
  // same cleanup removeSceneObject does, so converted shapes don't leave
  // stale line/fill rows (with their power/speed) in the Cuts panel.
  scene = pruneOrphanLayers(scene);
  return {
    project: { ...s.project, scene },
    selectedObjectId: converted.id,
    // The merged bitmap is the sole selection: any additional selected ids
    // pointed at sources that no longer exist.
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}
