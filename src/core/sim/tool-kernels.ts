// Tool kernels — the precomputed cutting footprint of a bit on the removal
// grid (Phase H.2, ADR-098). Each offset is a cell displacement plus the
// vertical clearance of the cutting surface at that horizontal distance
// (dz ≥ 0 above the tool tip):
//
//   end-mill              flat:      dz = 0 across the radius
//   ball-nose             sphere:    dz = r − sqrt(r² − d²)
//   v-bit                 cone:      dz = d / tan(θ/2)
//   engraving   truncated cone:      dz = max(0, (d − tipRadius) / tan(θ/2))
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
  // The tool and its radius travel with the kernel so a stamper can measure the
  // cutting surface from the tool's REAL position rather than from the lattice
  // distance baked into `offsets`. Roughing dilation and finishing still read
  // `offsets`, for which whole-cell distances are the right model.
  readonly tool: CncTool;
  readonly radiusMm: number;
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
  return { radiusCells, offsets, tool, radiusMm };
}

/**
 * Height of the tool's cutting surface above its lowest point, at a given
 * radial distance from the axis.
 *
 * Exported within core/sim so the drawn tool silhouette (tool-profile.ts) is
 * generated from the SAME function that stamps material away. Two independent
 * copies of this maths would let the preview show a ball nose while the
 * simulation cut a flat bottom.
 *
 * @param tool The tool whose cutting surface is being measured.
 * @param dMm Radial distance from the tool axis, in mm.
 * @param radiusMm The tool's radius, in mm.
 * @returns Height above the tool's lowest point, in mm.
 */
export function cuttingSurfaceDz(tool: CncTool, dMm: number, radiusMm: number): number {
  switch (tool.kind) {
    case 'end-mill':
      return 0;
    case 'engraving': {
      // A conical engraving bit is a TRUNCATED cone: a flat land of
      // tipDiameterMm, then conical flanks at the included angle. It was
      // modelled here as a flat disc across the FULL diameter, which
      // contradicted the CAM — vcarve-angle.ts plans an engraving bit as a cone
      // (falling back to 60° when the angle is unknown, the same value as
      // FALLBACK_V_TIP_ANGLE_DEG). The preview therefore showed a flat bottom
      // while the machine cut a V. Same law as a v-bit, offset by the tip land.
      const tipAngleDeg = tool.tipAngleDeg ?? FALLBACK_V_TIP_ANGLE_DEG;
      const halfAngleRad = (Math.max(1, tipAngleDeg) / 2) * (Math.PI / 180);
      const tipRadiusMm = Math.max(0, (tool.tipDiameterMm ?? 0) / 2);
      return Math.max(0, (dMm - tipRadiusMm) / Math.tan(halfAngleRad));
    }
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
