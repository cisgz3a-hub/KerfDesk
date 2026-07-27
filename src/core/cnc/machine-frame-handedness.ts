// Handedness of a device's machine number frame relative to the physical bed
// as the operator sees it (+X to the operator's right, +Y away from them).
//
// CNC contours are pushed through `toMachineCoords` while they are collected
// (collect-cnc-contours.ts), so every later stage reasons about MACHINE
// numbers. For origins that mirror exactly one axis, those numbers are a
// reflection of the physical bed: a shoelace sign computed on them means the
// OPPOSITE physical rotation to the same sign on an unmirrored machine. Any
// rule stated as an absolute "walk this contour clockwise" — climb vs
// conventional above all — has to be told which of the two frames it is in.
//
// `jogAxisSignsForOrigin` already carries the axis signs, and
// jog-direction.test.ts pins them to origin-transform's linear part, so the
// determinant of that pair is the single source of truth for handedness rather
// than a second hand-maintained table that could drift from the transform.

import { jogAxisSignsForOrigin, type Origin } from '../devices';

// +1 keeps the physical sense of a shoelace sign; -1 reverses it.
export type FrameHandedness = 1 | -1;

export function machineFrameHandedness(origin: Origin): FrameHandedness {
  const signs = jogAxisSignsForOrigin(origin);
  return signs.x * signs.y === 1 ? 1 : -1;
}
