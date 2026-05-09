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
 * than the object rectangle. A fresh compile's canvasPlanBounds is the closest
 * source to the actual emitted burn path, so framing should prefer it.
 */
export function resolveFrameSceneBounds(args: {
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
): { x: number; y: number }[] {
  const corners = [
    { x: sceneBounds.minX, y: sceneBounds.minY },
    { x: sceneBounds.maxX, y: sceneBounds.minY },
    { x: sceneBounds.maxX, y: sceneBounds.maxY },
    { x: sceneBounds.minX, y: sceneBounds.maxY },
    { x: sceneBounds.minX, y: sceneBounds.minY },
  ];
  return corners.map(p => transformPointToMachine(p, sceneBounds, transformOpts));
}
