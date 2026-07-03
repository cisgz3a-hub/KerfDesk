// Tool kernels — the precomputed cutting footprint of a bit on the removal
// grid (Phase H.2, ADR-098). Each offset is a cell displacement plus the
// vertical clearance of the cutting surface at that horizontal distance
// (dz ≥ 0 above the tool tip):
//
//   end-mill / engraving  flat:      dz = 0 across the radius
//   ball-nose             sphere:    dz = r − sqrt(r² − d²)
//   v-bit                 cone:      dz = d / tan(θ/2)
//
// The SAME kernels serve the H.2 simulator (stamping), H.5 roughing dilation,
// and H.8 finishing (max-plus tip surface) — built once, deliberately.

import { assertNever, type CncTool } from '../scene';

export type ToolKernelOffset = {
  readonly dx: number; // cells
  readonly dy: number; // cells
  readonly dz: number; // mm above the tip at this offset
};

export type ToolKernel = {
  readonly radiusCells: number;
  readonly offsets: ReadonlyArray<ToolKernelOffset>;
};

// V-bits with a missing/degenerate angle fall back to this so the cone stays
// a cone instead of dividing by tan(0).
const FALLBACK_V_TIP_ANGLE_DEG = 60;

export function kernelForTool(tool: CncTool, mmPerCell: number): ToolKernel {
  const radiusMm = Math.max(0, tool.diameterMm / 2);
  const radiusCells = Math.max(0, Math.ceil(radiusMm / mmPerCell));
  const offsets: ToolKernelOffset[] = [];
  for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
    for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
      const dMm = Math.hypot(dx, dy) * mmPerCell;
      if (dMm > radiusMm) continue;
      offsets.push({ dx, dy, dz: cuttingSurfaceDz(tool, dMm, radiusMm) });
    }
  }
  return { radiusCells, offsets };
}

function cuttingSurfaceDz(tool: CncTool, dMm: number, radiusMm: number): number {
  switch (tool.kind) {
    case 'end-mill':
    case 'engraving':
      return 0;
    case 'ball-nose': {
      const inside = Math.max(0, radiusMm * radiusMm - dMm * dMm);
      return radiusMm - Math.sqrt(inside);
    }
    case 'v-bit': {
      const tipAngleDeg = tool.tipAngleDeg ?? FALLBACK_V_TIP_ANGLE_DEG;
      const halfAngleRad = (Math.max(1, tipAngleDeg) / 2) * (Math.PI / 180);
      return dMm / Math.tan(halfAngleRad);
    }
    default:
      return assertNever(tool.kind, 'CncToolKind');
  }
}
