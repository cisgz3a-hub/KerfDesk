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
