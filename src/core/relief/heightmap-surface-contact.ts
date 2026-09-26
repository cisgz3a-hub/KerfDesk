// Exact cutter contact with the surface BETWEEN heightmap samples (ADR-412).
//
// The max-plus dilation in heightmap-tool-offset.ts tests the cutter against
// the sample points its lattice kernel reaches. On a steep wall the cutter's
// real contact lies between those samples, so the sampled maximum understates
// how high the tip must stay and the cutter dips into the wall: a 3.175 mm
// ball finishing a 70 degree wall at D/10 cells cut a median 0.05 mm (worst
// 0.14 mm) into it, measured normal to the wall.
//
// This module treats every grid quad whose corners are included as the upper
// envelope of BOTH of its diagonal triangulations (which also bounds the
// bilinear patch through the same four samples) and finds the highest tip at
// which the cutter touches any of those triangles:
//
//   tip(c) = max over triangles T and points p in T with |p - c| <= R of
//            h_T(p) - dz(|p - c|)
//
// Every supported cutter law dz (ToolKernel.surfaceDzAtRadius, including a
// horizontally widened roughing envelope) is convex and nondecreasing in
// radius, so the objective is concave on each triangle and along each edge.
// Its maximum is therefore either a facet contact on the uphill ray from c, at
// the radius where the cutter's slope matches the facet's, or it lies on a
// triangle edge. heightmap-surface-contact-geometry.ts solves both in closed
// form for flat, ball, conical and tapered-ball cutters; a widened ball or
// tapered law falls back to a golden-section search.
//
// Speed: elements are first bounded by their highest corner at their nearest
// distance, then every surviving element's facets are solved (closed form,
// and exact on planar walls), and only then do edges run for elements whose
// facet planes still allow a higher contact.
//
// Only included samples form triangles, so this never invents surface inside a
// mask-excluded area; excluded cells keep their separate whole-cell envelope.

import { partialCellCenter, partialGridHasPartialCell } from '../grid';
import { taperedBallEnvelope } from '../cnc-tapered-ball';
// Deep imports: the legacy core/cnc barrel is frozen by the export ratchet.
import { vcarveIncludedAngleDeg } from '../cnc/vcarve-angle';
import { conicalRadialEnvelope } from '../cnc/radial-envelope';
import type { ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import {
  A,
  B,
  C,
  corners,
  D,
  type ElementContact,
  elementEdges,
  elementFacets,
  isIncluded,
  read32,
  read64,
  readCorners,
  readInt,
  sortByBoundDescending,
} from './heightmap-surface-contact-element';
import { type ContactProfile, PRUNE_TOLERANCE_MM } from './heightmap-surface-contact-geometry';

const FALLBACK_V_TIP_ANGLE_DEG = 60;
// Radial step of the left secant that stands in for the cutter law's slope.
const SECANT_MM = 1e-6;

/** Exact contact heights for one heightmap and one cutter envelope. */
export type SurfaceContactField = {
  /**
   * The highest tip depth at which the cutter centred on sample (cx, cy)
   * touches the piecewise-linear surface, or `lowerBound` when no triangle
   * requires more. Never lower than `lowerBound`.
   */
  readonly constraint: (cx: number, cy: number, lowerBound: number) => number;
  /**
   * The same contact for a cutter centred anywhere, (x, y) in map mm: waterline
   * finishing places its vertices between samples (ADR-423).
   */
  readonly constraintAtPoint: (x: number, y: number, lowerBound: number) => number;
  /**
   * Whether a cutter centred at (x, y) may stand with its tip at z: its
   * contact there is at most z + slackMm. It stops at the first element found
   * to lift the tip higher, so a "no" costs less than a height (ADR-423).
   */
  readonly clearsAtPoint: (x: number, y: number, z: number, slackMm: number) => boolean;
};

type Contact = ElementContact & {
  // Highest included corner of the element whose top-left sample is (i, j),
  // or -Infinity when the element carries no edge.
  readonly elementTop: Float32Array;
  readonly span: number;
  // Nearest-approach cutter height for each element offset on a regular grid,
  // +Infinity beyond the cutter. Elements touching a shortened terminal cell
  // measure their exact distance instead.
  readonly regularNearDz: Float64Array;
  // The supporting-line bound's constant and per-corner slope terms (a, b, c,
  // d) for each regular element offset; see regularSupportBound.
  readonly regularSupportBase: Float64Array;
  readonly regularSupportSlopes: Float64Array;
  readonly regularSide: number;
  readonly terminalColumn: number | null;
  readonly terminalRow: number | null;
  // Per-call scratch, reused to avoid allocation in the dilation loop.
  readonly candidates: Int32Array;
  readonly candidateBound: Float64Array;
  readonly mmPerCell: number;
};

/** Precompute the triangulation bounds for one map and cutter envelope. */
export function createSurfaceContactField(
  map: Heightmap,
  kernel: ToolKernel,
): SurfaceContactField | null {
  const { widthCells, heightCells } = map;
  if (widthCells < 1 || heightCells < 1 || (widthCells < 2 && heightCells < 2)) return null;
  if (!(kernel.radiusMm > 0) || !Number.isFinite(kernel.radiusMm)) return null;
  const xs = new Float64Array(widthCells);
  const ys = new Float64Array(heightCells);
  for (let i = 0; i < widthCells; i += 1) xs[i] = partialCellCenter(map, 'x', i);
  for (let j = 0; j < heightCells; j += 1) ys[j] = partialCellCenter(map, 'y', j);
  const tolerance = 16 * Number.EPSILON * Math.max(1, kernel.radiusMm, kernel.mmPerCell);
  const radiusMm = kernel.radiusMm + tolerance;
  const dz = (distanceMm: number): number =>
    kernel.surfaceDzAtRadius(Math.min(kernel.radiusMm, distanceMm));
  const span = kernel.surfaceCandidateSpanCells;
  const side = 2 * span + 2;
  const contact: Contact = {
    xs,
    ys,
    widthCells,
    heightCells,
    depth: map.depth,
    inclusion: map.inclusion,
    elementTop: elementTops(map),
    radiusMm,
    radiusSquared: radiusMm * radiusMm,
    span,
    dz,
    profile: profileFor(kernel),
    regularNearDz: regularNearDzTable(kernel.mmPerCell, span, radiusMm, dz),
    ...regularSupportTables(kernel.mmPerCell, span, radiusMm, dz),
    regularSide: side,
    terminalColumn: partialGridHasPartialCell(map, 'x') ? widthCells - 1 : null,
    terminalRow: partialGridHasPartialCell(map, 'y') ? heightCells - 1 : null,
    // A point between samples reaches one element further than a sample does.
    candidates: new Int32Array((side + 1) * (side + 1)),
    candidateBound: new Float64Array((side + 1) * (side + 1)),
    mmPerCell: kernel.mmPerCell,
    roots: new Float64Array(6),
    facet: { planeBound: 0, candidate: 0, insideRectangle: 0 },
  };
  return {
    constraint: (cx, cy, lowerBound) => constraintAt(contact, cx, cy, lowerBound),
    constraintAtPoint: (x, y, lowerBound) => constraintAtPoint(contact, x, y, lowerBound),
    clearsAtPoint: (x, y, z, slackMm) =>
      constraintAtPoint(contact, x, y, z, z + slackMm) <= z + slackMm,
  };
}

function profileFor(kernel: ToolKernel): ContactProfile {
  const tool = kernel.tool;
  const growth = kernel.horizontalGrowthMm;
  switch (tool.kind) {
    case 'end-mill':
      return { kind: 'flat' };
    case 'ball-nose':
      return growth === 0 ? { kind: 'ball', ball: kernel.radiusMm } : { kind: 'search' };
    case 'v-bit':
    case 'engraving': {
      const envelope = conicalRadialEnvelope(
        tool,
        vcarveIncludedAngleDeg(tool) ?? FALLBACK_V_TIP_ANGLE_DEG,
      );
      if (envelope === null) return { kind: 'flat' };
      return { kind: 'cone', land: envelope.tipRadiusMm + growth, slope: 1 / envelope.tanHalf };
    }
    case 'tapered-ball-nose': {
      const envelope = taperedBallEnvelope(tool);
      if (envelope === null) return { kind: 'flat' };
      return growth === 0
        ? {
            kind: 'tapered',
            ball: envelope.ballRadiusMm,
            tangentRadius: envelope.tangentRadiusMm,
            slope: 1 / envelope.tanHalf,
          }
        : { kind: 'search' };
    }
    default:
      return { kind: 'search' };
  }
}

function elementTops(map: Heightmap): Float32Array {
  const { widthCells, heightCells, depth, inclusion } = map;
  const tops = new Float32Array(widthCells * heightCells).fill(Number.NEGATIVE_INFINITY);
  for (let j = 0; j < heightCells; j += 1) {
    for (let i = 0; i < widthCells; i += 1) {
      let top = Number.NEGATIVE_INFINITY;
      let count = 0;
      for (let dj = 0; dj <= 1; dj += 1) {
        for (let di = 0; di <= 1; di += 1) {
          if (i + di >= widthCells || j + dj >= heightCells) continue;
          const index = (j + dj) * widthCells + i + di;
          if (!isIncluded(inclusion, index)) continue;
          count += 1;
          top = Math.max(top, read32(depth, index));
        }
      }
      if (count >= 2) tops[j * widthCells + i] = top;
    }
  }
  return tops;
}

// Element (cx + di, cy + dj) spans [di, di + 1] x [dj, dj + 1] cells from the
// center on a regular grid, so its nearest-approach cutter height is a table.
function regularNearDzTable(
  mmPerCell: number,
  span: number,
  radiusMm: number,
  dz: (radiusMm: number) => number,
): Float64Array {
  const side = 2 * span + 2;
  const table = new Float64Array(side * side);
  for (let row = 0; row < side; row += 1) {
    const dy = axisGapMm(row - span - 1, mmPerCell);
    for (let col = 0; col < side; col += 1) {
      const distance = Math.hypot(axisGapMm(col - span - 1, mmPerCell), dy);
      table[row * side + col] = distance > radiusMm ? Number.POSITIVE_INFINITY : dz(distance);
    }
  }
  return table;
}

function axisGapMm(offset: number, mmPerCell: number): number {
  if (offset > 0) return offset * mmPerCell;
  return offset + 1 < 0 ? -(offset + 1) * mmPerCell : 0;
}

function regularSupportTables(
  mmPerCell: number,
  span: number,
  radiusMm: number,
  dz: (radiusMm: number) => number,
): { readonly regularSupportBase: Float64Array; readonly regularSupportSlopes: Float64Array } {
  const side = 2 * span + 2;
  const base = new Float64Array(side * side).fill(Number.POSITIVE_INFINITY);
  const slopes = new Float64Array(side * side * 4);
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const di = col - span - 1;
      const dj = row - span - 1;
      const rho = Math.hypot(axisGapMm(di, mmPerCell), axisGapMm(dj, mmPerCell));
      const line = supportingLine(
        dz,
        rho,
        radiusMm,
        (di + 0.5) * mmPerCell,
        (dj + 0.5) * mmPerCell,
      );
      if (line === null) continue;
      const index = row * side + col;
      base[index] = line.base;
      const x0 = di * mmPerCell;
      const y0 = dj * mmPerCell;
      slopes[index * 4] = line.gx * x0 + line.gy * y0;
      slopes[index * 4 + 1] = line.gx * (x0 + mmPerCell) + line.gy * y0;
      slopes[index * 4 + 2] = line.gx * x0 + line.gy * (y0 + mmPerCell);
      slopes[index * 4 + 3] = line.gx * (x0 + mmPerCell) + line.gy * (y0 + mmPerCell);
    }
  }
  return { regularSupportBase: base, regularSupportSlopes: slopes };
}

// The supporting line of the cutter law at the element's nearest approach
// rho, pointed at the element's middle (mx, my) relative to the axis: slope
// vector (gx, gy) and constant g rho - dz(rho). Null when it gives no bound.
function supportingLine(
  dz: (radiusMm: number) => number,
  rho: number,
  radiusMm: number,
  mx: number,
  my: number,
): { readonly gx: number; readonly gy: number; readonly base: number } | null {
  if (!(rho > SECANT_MM) || rho > radiusMm) return null;
  const near = dz(rho);
  const g = (near - dz(rho - SECANT_MM)) / SECANT_MM;
  const length = Math.hypot(mx, my);
  if (!(g > 0) || !Number.isFinite(g) || !(length > 0)) return null;
  return { gx: (g * mx) / length, gy: (g * my) / length, base: g * rho - near };
}

function constraintAt(contact: Contact, cx: number, cy: number, lowerBound: number): number {
  const xc = read64(contact.xs, cx);
  const yc = read64(contact.ys, cy);
  const count = collectCandidates(contact, cx, cy, xc, yc, lowerBound);
  sortByBoundDescending(contact.candidates, contact.candidateBound, count);
  return refineCandidates(contact, count, xc, yc, lowerBound);
}

// With `stopAbove`, the result is only exact up to it: any contact higher
// than it is returned as soon as one is found.
function constraintAtPoint(
  contact: Contact,
  x: number,
  y: number,
  lowerBound: number,
  stopAbove = Number.POSITIVE_INFINITY,
): number {
  const reach = contact.span + 1;
  const i = sampleAtOrBefore(contact.xs, contact.widthCells, x, contact.mmPerCell);
  const j = sampleAtOrBefore(contact.ys, contact.heightCells, y, contact.mmPerCell);
  const maxI = Math.min(contact.widthCells - 1, i + reach);
  const maxJ = Math.min(contact.heightCells - 1, j + reach);
  const threshold = lowerBound + PRUNE_TOLERANCE_MM;
  let count = 0;
  for (let ej = Math.max(0, j - reach); ej <= maxJ; ej += 1) {
    for (let ei = Math.max(0, i - reach); ei <= maxI; ei += 1) {
      const element = ej * contact.widthCells + ei;
      // The tip is the cutter's lowest point, so an element no higher than
      // the bound cannot lift it past the bound.
      const top = read32(contact.elementTop, element);
      if (!(top > threshold)) continue;
      const near = top - exactNearDz(contact, ei, ej, x, y);
      if (!(near > threshold)) continue;
      const bound = Math.min(near, exactSupportBound(contact, ei, ej, x, y));
      if (!(bound > threshold)) continue;
      contact.candidates[count] = element;
      contact.candidateBound[count] = bound;
      count += 1;
    }
  }
  sortByBoundDescending(contact.candidates, contact.candidateBound, count);
  return refineCandidates(contact, count, x, y, lowerBound, stopAbove);
}

// The last sample at or before `coordinate` along one axis (the first when
// the point lies before it).
function sampleAtOrBefore(
  centers: Float64Array,
  cells: number,
  coordinate: number,
  mmPerCell: number,
): number {
  let index = Math.min(cells - 1, Math.max(0, Math.floor(coordinate / mmPerCell - 0.5)));
  while (index > 0 && read64(centers, index) > coordinate) index -= 1;
  while (index + 1 < cells && read64(centers, index + 1) <= coordinate) index += 1;
  return index;
}

// Elements whose highest corner, at their nearest approach, could still lift
// the tip above `lowerBound`. Returns how many were written to the scratch.
function collectCandidates(
  contact: Contact,
  cx: number,
  cy: number,
  xc: number,
  yc: number,
  lowerBound: number,
): number {
  const { widthCells, span, candidates, candidateBound, terminalColumn, terminalRow } = contact;
  const minI = Math.max(0, cx - span - 1);
  const maxI = Math.min(widthCells - 1, cx + span);
  const minJ = Math.max(0, cy - span - 1);
  const maxJ = Math.min(contact.heightCells - 1, cy + span);
  const regularCenter = cx !== terminalColumn && cy !== terminalRow;
  const threshold = lowerBound + PRUNE_TOLERANCE_MM;
  let count = 0;
  for (let j = minJ; j <= maxJ; j += 1) {
    const regularRow = regularCenter && !touchesTerminal(j, terminalRow);
    const tableRow = (j - cy + span + 1) * contact.regularSide - cx + span + 1;
    for (let i = minI; i <= maxI; i += 1) {
      const element = j * widthCells + i;
      const top = read32(contact.elementTop, element);
      if (!(top > threshold)) continue;
      const regular = regularRow && !touchesTerminal(i, terminalColumn);
      const nearDz = regular
        ? read64(contact.regularNearDz, tableRow + i)
        : exactNearDz(contact, i, j, xc, yc);
      if (!(top - nearDz > threshold)) continue;
      const support = regular
        ? regularSupportBound(contact, i, j, tableRow + i)
        : exactSupportBound(contact, i, j, xc, yc);
      const bound = Math.min(top - nearDz, support);
      if (!(bound > threshold)) continue;
      candidates[count] = element;
      candidateBound[count] = bound;
      count += 1;
    }
  }
  return count;
}

// A tighter element bound than its highest corner. No point of the element is
// nearer the axis than rho, so the convex cutter law lies above its supporting
// line there, dz(|p - c|) >= dz(rho) + g (|p - c| - rho), for any slope g from
// 0 up to its right derivative at rho (a left secant qualifies). With
// |p - c| >= u . (p - c) for a unit u, h(p) - dz(|p - c|) is at most
// h(p) - g u . (p - c) - dz(rho) + g rho, which is linear on every triangle
// and edge and so peaks at a corner.
function regularSupportBound(contact: Contact, i: number, j: number, table: number): number {
  const base = read64(contact.regularSupportBase, table);
  if (base === Number.POSITIVE_INFINITY) return base;
  const k = corners;
  readCorners(contact, i, j, k);
  const slopes = contact.regularSupportSlopes;
  const at = table * 4;
  return (
    base +
    Math.max(
      k.mask & A ? k.za - read64(slopes, at) : Number.NEGATIVE_INFINITY,
      k.mask & B ? k.zb - read64(slopes, at + 1) : Number.NEGATIVE_INFINITY,
      k.mask & C ? k.zc - read64(slopes, at + 2) : Number.NEGATIVE_INFINITY,
      k.mask & D ? k.zd - read64(slopes, at + 3) : Number.NEGATIVE_INFINITY,
    )
  );
}

// The same bound measured exactly, for elements touching a shortened cell.
function exactSupportBound(contact: Contact, i: number, j: number, xc: number, yc: number): number {
  const k = corners;
  readCorners(contact, i, j, k);
  const ax = k.xa - xc;
  const bx = k.xb - xc;
  const ay = k.ya - yc;
  const cy = k.yc - yc;
  const dx = ax > 0 ? ax : bx < 0 ? -bx : 0;
  const dy = ay > 0 ? ay : cy < 0 ? -cy : 0;
  const line = supportingLine(
    contact.dz,
    Math.sqrt(dx * dx + dy * dy),
    contact.radiusMm,
    (ax + bx) / 2,
    (ay + cy) / 2,
  );
  if (line === null) return Number.POSITIVE_INFINITY;
  const { gx, gy } = line;
  return (
    line.base +
    Math.max(
      k.mask & A ? k.za - gx * ax - gy * ay : Number.NEGATIVE_INFINITY,
      k.mask & B ? k.zb - gx * bx - gy * ay : Number.NEGATIVE_INFINITY,
      k.mask & C ? k.zc - gx * ax - gy * cy : Number.NEGATIVE_INFINITY,
      k.mask & D ? k.zd - gx * bx - gy * cy : Number.NEGATIVE_INFINITY,
    )
  );
}

function touchesTerminal(index: number, terminal: number | null): boolean {
  return index === terminal || index + 1 === terminal;
}

function refineCandidates(
  contact: Contact,
  count: number,
  xc: number,
  yc: number,
  lowerBound: number,
  stopAbove = Number.POSITIVE_INFINITY,
): number {
  const { widthCells, candidates, candidateBound } = contact;
  let best = lowerBound;
  // Pass 1: facets, most promising first, so the best contact rises early and
  // prunes the rest. Each element's bound tightens to its highest facet plane.
  for (let k = 0; k < count; k += 1) {
    const bound = read64(candidateBound, k);
    if (!(bound > best + PRUNE_TOLERANCE_MM)) {
      candidateBound[k] = Number.NEGATIVE_INFINITY;
      continue;
    }
    const element = readInt(candidates, k);
    const i = element % widthCells;
    const facets = elementFacets(contact, i, (element - i) / widthCells, xc, yc, best);
    best = facets.best;
    if (best > stopAbove) return best;
    candidateBound[k] = Math.min(bound, facets.planeBound);
  }
  // Pass 2: edges, only where a facet plane still allows a higher contact.
  for (let k = 0; k < count; k += 1) {
    if (!(read64(candidateBound, k) > best + PRUNE_TOLERANCE_MM)) continue;
    const element = readInt(candidates, k);
    const i = element % widthCells;
    best = elementEdges(contact, i, (element - i) / widthCells, xc, yc, best);
    if (best > stopAbove) return best;
  }
  return best;
}

function exactNearDz(contact: Contact, i: number, j: number, xc: number, yc: number): number {
  const x0 = read64(contact.xs, i);
  const x1 = read64(contact.xs, Math.min(i + 1, contact.widthCells - 1));
  const y0 = read64(contact.ys, j);
  const y1 = read64(contact.ys, Math.min(j + 1, contact.heightCells - 1));
  const dx = x0 > xc ? x0 - xc : xc > x1 ? xc - x1 : 0;
  const dy = y0 > yc ? y0 - yc : yc > y1 ? yc - y1 : 0;
  const distanceSquared = dx * dx + dy * dy;
  return distanceSquared > contact.radiusSquared
    ? Number.POSITIVE_INFINITY
    : contact.dz(Math.sqrt(distanceSquared));
}
