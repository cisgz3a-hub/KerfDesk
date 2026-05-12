import { type AABB } from '../core/types';
import {
  transformPointToMachine,
  type MachineTransformOptions,
} from '../core/plan/MachineTransform';
import {
  buildGrblFrameGcode as buildFrameGcode,
  type GrblFrameGcodeOpts as FrameGcodeOpts,
} from '../controllers/grbl/GrblFrameGcode';

export type { MachineTransformOptions as FrameTransformOpts } from '../core/plan/MachineTransform';
export { buildFrameGcode, type FrameGcodeOpts };

function isUsableFrameBounds(bounds: AABB | null | undefined): bounds is AABB {
  return (
    bounds != null
    && Number.isFinite(bounds.minX)
    && Number.isFinite(bounds.minY)
    && Number.isFinite(bounds.maxX)
    && Number.isFinite(bounds.maxY)
    && bounds.maxX >= bounds.minX
    && bounds.maxY >= bounds.minY
  );
}

function copyBounds(bounds: AABB): AABB {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
}

/**
 * T3-36: choose the scene-space bounds the frame command should trace.
 *
 * Raw output-object bounds are the right fallback when no fresh compile exists,
 * but raster jobs and generated toolpaths can burn a tighter/different envelope
 * than the object rectangle. A fresh compile's canvasBurnBounds is the closest
 * source to the actual emitted burn path, so framing should prefer it. Older
 * compile results may only carry canvasPlanBounds; keep that as a fallback.
 */
export function resolveFrameSceneBounds(args: {
  outputBounds: AABB;
  compiledCanvasBurnBounds?: AABB | null | undefined;
  compiledCanvasPlanBounds: AABB | null | undefined;
  hasFreshCompile: boolean;
}): AABB {
  if (args.hasFreshCompile && isUsableFrameBounds(args.compiledCanvasBurnBounds)) {
    return copyBounds(args.compiledCanvasBurnBounds);
  }
  if (args.hasFreshCompile && isUsableFrameBounds(args.compiledCanvasPlanBounds)) {
    return copyBounds(args.compiledCanvasPlanBounds);
  }
  return copyBounds(args.outputBounds);
}

/**
 * T2-6 Phase 3x: choose the bounds the frame-command machine
 * transform should use as its reference rectangle.
 *
 * Companion to `resolveFrameSceneBounds`: where that picks the
 * scene-space bounds the framing PATH is built from (preferring the
 * tighter burn envelope), this picks the bounds the AXIS-MIRROR /
 * front-right-corner transform anchors on. The transform side
 * intentionally ignores burn bounds — it only cares about the planar
 * extent of the emitted toolpath so the transform's "rectangle the
 * head will sweep" stays the same as what the planner already
 * produced. When there's no fresh compile, falls back to the raw
 * output-object bounds (same as the scene path).
 *
 * Pre-Phase-3x this lived inline in `App.tsx` as a ternary
 * (`!gcodeStale && currentGcode && lastResult?.canvasPlanBounds`).
 * Extracting it co-locates the bounds-resolution policy with the
 * sister scene-bounds helper above so a future framing-bounds
 * change touches one file.
 */
export function resolveFrameTransformBounds(args: {
  outputBounds: AABB;
  compiledCanvasPlanBounds: AABB | null | undefined;
  hasFreshCompile: boolean;
}): AABB {
  if (args.hasFreshCompile && isUsableFrameBounds(args.compiledCanvasPlanBounds)) {
    return copyBounds(args.compiledCanvasPlanBounds);
  }
  return copyBounds(args.outputBounds);
}

export function buildFrameCorners(
  sceneBounds: AABB,
  transformOpts: MachineTransformOptions,
  transformReferenceBounds: AABB = sceneBounds,
): { x: number; y: number }[] {
  const corners = [
    { x: sceneBounds.minX, y: sceneBounds.minY },
    { x: sceneBounds.maxX, y: sceneBounds.minY },
    { x: sceneBounds.maxX, y: sceneBounds.maxY },
    { x: sceneBounds.minX, y: sceneBounds.maxY },
    { x: sceneBounds.minX, y: sceneBounds.minY },
  ];
  return corners.map(p => transformPointToMachine(p, transformReferenceBounds, transformOpts));
}
