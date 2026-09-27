// head-position-frames — the two coordinate frames a typed or saved head
// position can use (LightBurn gap LBG-M02 / LBG-T15, ADR-483), and their exact
// mapping to and from the controller's native machine position (MPos).
//
// `bed` is canvas coordinates: the scene millimetres the rulers and the X/Y
// boxes show. It maps through the SAME origin transform G-code emission uses,
// then the verified native bed frame click-to-move uses. Without a verified
// frame it lands where an Absolute job puts that canvas point (native targets
// equal machine coordinates, as start-job preparation does), reported as
// unverified so the caller can say the physical spot must be checked.
// `origin` is work coordinates: millimetres from the work origin, which is what
// a job's G-code numbers mean. MPos = WPos + WCO, so it needs no homing.

import type { Vec2 } from '../scene';
import type { DeviceProfile, SavedPositionFrame } from './device-profile';
import { bedPointToNative, nativePointToBed, type NativeBedFrame } from './native-bed-frame';
import { toMachineCoords, toSceneCoords } from './origin-transform';

/** A head position the operator typed, saved or picked on the canvas. */
export type HeadPosition = {
  readonly frame: SavedPositionFrame;
  readonly xMm: number;
  readonly yMm: number;
};

/** What converting needs: the bed mapping for `bed`, the work offset for `origin`. */
export type HeadFrameContext = {
  readonly device: DeviceProfile;
  readonly nativeFrame: NativeBedFrame | null;
  readonly workOffsetMm: Vec2 | null;
};

export type HeadPositionResolution =
  | { readonly kind: 'native'; readonly point: Vec2; readonly verified: boolean }
  | { readonly kind: 'needs-work-offset' };

/** The native MPos for a head position, or which fact is missing. */
export function headPositionToNative(
  position: HeadPosition,
  context: HeadFrameContext,
): HeadPositionResolution {
  const point = { x: position.xMm, y: position.yMm };
  if (position.frame === 'bed') {
    const machine = toMachineCoords(point, context.device);
    return context.nativeFrame === null
      ? { kind: 'native', point: machine, verified: false }
      : { kind: 'native', point: bedPointToNative(machine, context.nativeFrame), verified: true };
  }
  if (context.workOffsetMm === null) return { kind: 'needs-work-offset' };
  return {
    kind: 'native',
    point: { x: point.x + context.workOffsetMm.x, y: point.y + context.workOffsetMm.y },
    verified: true,
  };
}

/** The head's current native MPos in the given frame, or null without a work offset. */
export function nativeToHeadPosition(
  native: Vec2,
  frame: SavedPositionFrame,
  context: HeadFrameContext,
): HeadPosition | null {
  if (frame === 'bed') {
    const bed =
      context.nativeFrame === null ? native : nativePointToBed(native, context.nativeFrame);
    const scene = toSceneCoords(bed, context.device);
    return { frame, xMm: roundMicron(scene.x), yMm: roundMicron(scene.y) };
  }
  if (context.workOffsetMm === null) return null;
  return {
    frame,
    xMm: roundMicron(native.x - context.workOffsetMm.x),
    yMm: roundMicron(native.y - context.workOffsetMm.y),
  };
}

// Status reports carry three decimals; a saved or shown position keeps the
// same precision instead of float noise such as 12.300000000000001.
function roundMicron(value: number): number {
  return Math.round(value * 1000) / 1000;
}
