// ADR-029 Convert to Bitmap — the pure scene mutation that swaps a selected
// vector object for the RasterImage rasterized from it.
//
// This is the LightBurn-faithful INVERSE of Trace: where applyTraceToExisting
// (ADR-026) KEEPS the source bitmap behind the new vector, Convert to Bitmap
// DELETES the source vector (LightBurn discards the original — it warns and
// suggests duplicating first). The asymmetry is intentional and ADR-justified.
//
// Division of labour: the UI builds the RasterImage (canvas PNG encode + luma
// extraction are DOM/browser work, and the new id is minted there) carrying
// the source's own bounds + transform, so the bitmap lands exactly where the
// vector was. This helper does only the pure, deterministic scene transform —
// drop the source, add the raster on a fresh image-mode layer, prune the
// source's now-orphaned color layer, and record a single undo entry — so it
// unit-tests without a DOM, like every other helper in scene-mutations.
//
// Total + defensive: if `sourceId` no longer resolves (shouldn't happen — the
// Convert button is gated on a live vector selection behind the toolbar), the
// raster is still added rather than silently lost, mirroring
// applyTraceToExisting's missing-source fallback.

import { addObject, type RasterImage, removeObject } from '../../core/scene';
import {
  ensureRasterImageLayer,
  type MutationResult,
  pruneOrphanLayers,
  pushUndo,
  type StateSlice,
} from './scene-mutations';

export function applyConvertToBitmap(
  s: StateSlice,
  sourceId: string,
  raster: RasterImage,
): MutationResult {
  let scene = s.project.scene;
  const existing = scene.objects.find((o) => o.id === sourceId);
  if (existing !== undefined) {
    scene = removeObject(scene, sourceId);
  }
  scene = addObject(scene, raster);
  scene = ensureRasterImageLayer(scene, raster.color);
  // Drop the source vector's color layer if nothing else references it —
  // same cleanup removeSceneObject does, so a converted shape doesn't leave
  // a stale line/fill row (with its power/speed) in the Cuts panel.
  scene = pruneOrphanLayers(scene);
  return {
    project: { ...s.project, scene },
    selectedObjectId: raster.id,
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}
