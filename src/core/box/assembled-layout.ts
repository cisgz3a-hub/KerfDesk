// assembled-layout — every generated part's 3D frame (ADR-119): map a
// panel's local (u, v) rings into box coordinates for the assembled
// preview. This is the referee's placement knowledge exposed as a layout;
// the two stay in sync by re-deriving from the documented drawing
// convention, never by importing each other.

import type { BoxSpec } from './box-spec';
import { deriveBoxDims } from './box-spec';
import { dividerLayout, hasDividers } from './divider-layout';
import type { BoxPanel } from './generate-box';

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export type PartFrame = {
  readonly originMm: Vec3;
  readonly uDir: Vec3;
  readonly vDir: Vec3;
  readonly normalDir: Vec3;
  readonly thicknessMm: number;
};

const X: Vec3 = { x: 1, y: 0, z: 0 };
const Y: Vec3 = { x: 0, y: 1, z: 0 };
const Z: Vec3 = { x: 0, y: 0, z: 1 };

/** The 3D frame for one generated part, or null for unknown kinds. */
export function partFrame(panel: BoxPanel, spec: BoxSpec): PartFrame | null {
  const dims = deriveBoxDims(spec);
  const t = spec.thicknessMm;
  const frame = (originMm: Vec3, uDir: Vec3, vDir: Vec3, normalDir: Vec3): PartFrame => ({
    originMm,
    uDir,
    vDir,
    normalDir,
    thicknessMm: t,
  });
  switch (panel.panel) {
    case 'bottom':
      return frame({ x: 0, y: 0, z: 0 }, X, Y, Z);
    case 'top':
      return frame({ x: 0, y: 0, z: dims.outerHeightMm - t }, X, Y, Z);
    case 'front':
      return frame({ x: 0, y: 0, z: 0 }, X, Z, Y);
    case 'back':
      return frame({ x: 0, y: dims.outerDepthMm - t, z: 0 }, X, Z, Y);
    case 'left':
      return frame({ x: 0, y: 0, z: 0 }, Y, Z, X);
    case 'right':
      return frame({ x: dims.outerWidthMm - t, y: 0, z: 0 }, Y, Z, X);
    case 'lid':
      // The slide lid rides the channel band directly under the top strip.
      return frame({ x: 0, y: 0, z: dims.outerHeightMm - 2 * t }, X, Y, Z);
    case 'divider':
      return dividerFrame(panel, spec, t);
  }
}

// Dividers stand on the bottom face; X-dividers span depth (u = y),
// Y-dividers span width (u = x), matching divider-panels' local frames.
function dividerFrame(panel: BoxPanel, spec: BoxSpec, t: number): PartFrame | null {
  if (panel.divider === undefined || !hasDividers(spec)) return null;
  const layout = dividerLayout(spec);
  const placements = panel.divider.axis === 'x' ? layout.xDividers : layout.yDividers;
  const placement = placements[panel.divider.index];
  if (placement === undefined) return null;
  if (panel.divider.axis === 'x') {
    return {
      originMm: { x: placement.startMm, y: 0, z: t },
      uDir: Y,
      vDir: Z,
      normalDir: X,
      thicknessMm: t,
    };
  }
  return {
    originMm: { x: 0, y: placement.startMm, z: t },
    uDir: X,
    vDir: Z,
    normalDir: Y,
    thicknessMm: t,
  };
}

/** Map a local (u, v) point through a frame at plate depth w ∈ [0, T]. */
export function framePoint(frame: PartFrame, u: number, v: number, w: number): Vec3 {
  return {
    x: frame.originMm.x + u * frame.uDir.x + v * frame.vDir.x + w * frame.normalDir.x,
    y: frame.originMm.y + u * frame.uDir.y + v * frame.vDir.y + w * frame.normalDir.y,
    z: frame.originMm.z + u * frame.uDir.z + v * frame.vDir.z + w * frame.normalDir.z,
  };
}
