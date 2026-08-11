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
//
// Engraving bits cone with the V-bits. They were previously grouped with the
// flat end mills, which made the removal grid, the roughing dilation and the
// finishing tip surface all model a flat-bottomed trench the full width of the
// cutter, while vcarve-depth.ts drove Z down a cone via vcarveIncludedAngleDeg
// — one bit, two geometries, and the preview disagreed with the carve. 2L Inc
// and PreciseBits both specify conical engraving cutters by INCLUDED angle,
// which is the same quantity tipAngleDeg already carries for a V-bit.
//
// A plain cone still overstated how fine the point is, because a real cutter
// has a small flat at its tip (0.12–0.76 mm on 2L Inc's catalog). CncTool now
// carries tipDiameterMm, so an engraving bit is modelled as the TRUNCATED cone
// it actually is. An absent value means a true point, which is both the legacy
// behaviour and correct for a V-bit, so saved projects are unchanged.

import { assertNever, type CncTool } from '../scene';
// Deep imports: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import { CNC_MASK_EMISSION_XY_CLEARANCE_MM } from '../cnc/cnc-output-precision';
import { vcarveIncludedAngleDeg } from '../cnc/vcarve-angle';
import { conicalRadialEnvelope, radialEnvelopeHeightMm } from '../cnc/radial-envelope';

export type ToolKernelOffset = {
  readonly dx: number; // cells
  readonly dy: number; // cells
  readonly dz: number; // mm above the tip at this offset
};

export type ToolKernel = {
  readonly radiusCells: number;
  readonly offsets: ReadonlyArray<ToolKernelOffset>;
  // Mask cells represent square areas, not point samples. These offsets cover
  // every cell square intersected by the physical cutter plus the caller's
  // path-location uncertainty; dz is taken at the nearest possible point.
  readonly maskCellOffsets?: ReadonlyArray<ToolKernelOffset>;
  // A finishing chord lies no farther than half a cell from one of its adjacent
  // sampled endpoints. This wider XY-only envelope identifies endpoints that
  // cannot be joined, while maskCellOffsets retains the tighter stationary Z
  // constraint so safely reachable one-cell lobes are not discarded.
  readonly maskSweepCellOffsets?: ReadonlyArray<ToolKernelOffset>;
};

// V-bits with a missing/degenerate angle fall back to this so the cone stays
// a cone instead of dividing by tan(0).
const FALLBACK_V_TIP_ANGLE_DEG = 60;

export function kernelForTool(
  tool: CncTool,
  mmPerCell: number,
  maskPathUncertaintyMm = 0,
): ToolKernel {
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
  return {
    radiusCells,
    offsets,
    maskCellOffsets: maskCellOffsets(
      tool,
      radiusMm,
      mmPerCell,
      maskPathUncertaintyMm + CNC_MASK_EMISSION_XY_CLEARANCE_MM,
    ),
    maskSweepCellOffsets: maskCellOffsets(
      tool,
      radiusMm,
      mmPerCell,
      mmPerCell / 2 + CNC_MASK_EMISSION_XY_CLEARANCE_MM,
    ),
  };
}

function maskCellOffsets(
  tool: CncTool,
  radiusMm: number,
  mmPerCell: number,
  centerClearanceMm: number,
): ReadonlyArray<ToolKernelOffset> {
  const halfCell = mmPerCell / 2;
  const span = Math.ceil((radiusMm + centerClearanceMm + Math.SQRT2 * halfCell) / mmPerCell);
  const tolerance = Number.EPSILON * Math.max(1, radiusMm, mmPerCell) * 16;
  const offsets: ToolKernelOffset[] = [];
  for (let dy = -span; dy <= span; dy += 1) {
    for (let dx = -span; dx <= span; dx += 1) {
      const nearestX = Math.max(0, Math.abs(dx) * mmPerCell - halfCell);
      const nearestY = Math.max(0, Math.abs(dy) * mmPerCell - halfCell);
      const nearestDistanceMm = Math.max(0, Math.hypot(nearestX, nearestY) - centerClearanceMm);
      if (nearestDistanceMm > radiusMm + tolerance) continue;
      offsets.push({
        dx,
        dy,
        dz: cuttingSurfaceDz(tool, Math.min(radiusMm, nearestDistanceMm), radiusMm),
      });
    }
  }
  return offsets;
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
      return conicalSurfaceDz(tool, dMm);
    }
    case 'ball-nose': {
      const inside = Math.max(0, radiusMm * radiusMm - dMm * dMm);
      return radiusMm - Math.sqrt(inside);
    }
    case 'v-bit': {
      return conicalSurfaceDz(tool, dMm);
    }
    default:
      return assertNever(tool.kind, 'CncToolKind');
  }
}

function conicalSurfaceDz(tool: CncTool, radiusMm: number): number {
  const includedAngleDeg = vcarveIncludedAngleDeg(tool) ?? FALLBACK_V_TIP_ANGLE_DEG;
  const envelope = conicalRadialEnvelope(tool, includedAngleDeg);
  // Invalid explicit flat-tip metadata is not silently reinterpreted as a
  // point. Persistence rejects it; raw in-memory data previews conservatively
  // as a full flat land until the tool is corrected.
  return envelope === null ? 0 : radialEnvelopeHeightMm(envelope, radiusMm);
}
