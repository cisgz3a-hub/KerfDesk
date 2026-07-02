// computeRemovalGrid — sweep the tool kernel along a toolpath's cutting steps
// and record the deepest visit per cell (Phase H.2, ADR-094). This is the
// depth field behind the CNC preview's material-removal shading, and the
// verification instrument for every depth-producing feature after it
// (V-carve, relief): the perceptual tests compare this grid against analytic
// ground truth.
//
// Pure and deterministic: the grid is allocated and filled inside this
// function — no caller-visible mutation, indexed loops only. Sampling walks
// each cut segment at half-cell spacing plus exact endpoints, so no cell the
// tool touched is skipped.
//
// Approximation (documented): a cut step carries one Z span across its whole
// polyline; Z interpolates linearly by arc length within the step. Contour
// passes are exact (flat Z); path3d steps are exact at vertices and linear
// between — adequate for a preview grid at 0.2 mm cells.

import type { Toolpath, ToolpathStep } from '../job';
import {
  createRemovalGrid,
  gridCellIndex,
  gridCellOfPoint,
  type RemovalGrid,
  type RemovalGridSpec,
} from './removal-grid';
import type { ToolKernel } from './tool-kernels';

export type ComputeRemovalOptions = {
  // Only stamp the first `uptoLengthMm` of the toolpath — the scrubber's
  // partial-progress view. Omit for the finished cut.
  readonly uptoLengthMm?: number;
};

export function computeRemovalGrid(
  toolpath: Toolpath,
  spec: RemovalGridSpec,
  kernel: ToolKernel,
  options: ComputeRemovalOptions = {},
): RemovalGrid {
  const grid = createRemovalGrid(spec);
  const limit = options.uptoLengthMm ?? Number.POSITIVE_INFINITY;
  let traversed = 0;
  for (const step of toolpath.steps) {
    if (traversed >= limit) break;
    const budget = limit - traversed;
    stampStep(grid, kernel, step, budget);
    traversed += step.length;
  }
  return grid;
}

function stampStep(
  grid: RemovalGrid,
  kernel: ToolKernel,
  step: ToolpathStep,
  budgetMm: number,
): void {
  if (step.kind === 'travel') return;
  if (step.kind === 'plunge') {
    // Vertical move at fixed XY: the tip reaches min(fromZ, toZ) — capped by
    // the budget fraction when the scrubber stops mid-plunge.
    const t = step.length > 0 ? Math.min(1, budgetMm / step.length) : 1;
    const reachedZ = step.fromZ + (step.toZ - step.fromZ) * t;
    if (reachedZ < 0) stampTip(grid, kernel, step.at.x, step.at.y, reachedZ);
    return;
  }
  stampCutStep(grid, kernel, step, budgetMm);
}

function stampCutStep(
  grid: RemovalGrid,
  kernel: ToolKernel,
  step: Extract<ToolpathStep, { kind: 'cut' }>,
  budgetMm: number,
): void {
  const zFrom = step.z?.from ?? 0;
  const zTo = step.z?.to ?? 0;
  if (zFrom >= 0 && zTo >= 0) return; // laser steps carry no depth
  const totalLength = Math.max(step.length, 1e-9);
  let walked = 0;
  for (let i = 1; i < step.polyline.length; i += 1) {
    const a = step.polyline[i - 1];
    const b = step.polyline[i];
    if (a === undefined || b === undefined) continue;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const done = stampSegment(grid, kernel, a, b, {
      segLen,
      walked,
      budgetMm,
      totalLength,
      zFrom,
      zTo,
    });
    if (done) return;
    walked += segLen;
  }
}

type SegmentStampParams = {
  readonly segLen: number;
  readonly walked: number;
  readonly budgetMm: number;
  readonly totalLength: number;
  readonly zFrom: number;
  readonly zTo: number;
};

// Returns true when the scrub budget ran out inside this segment.
function stampSegment(
  grid: RemovalGrid,
  kernel: ToolKernel,
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  p: SegmentStampParams,
): boolean {
  const sampleSpacing = grid.mmPerCell / 2;
  const samples = Math.max(1, Math.ceil(p.segLen / sampleSpacing));
  for (let s = 0; s <= samples; s += 1) {
    const t = s / samples;
    const along = p.walked + p.segLen * t;
    if (along > p.budgetMm) return true;
    const zT = Math.min(1, along / p.totalLength);
    const z = p.zFrom + (p.zTo - p.zFrom) * zT;
    if (z < 0) stampTip(grid, kernel, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, z);
  }
  return false;
}

function stampTip(grid: RemovalGrid, kernel: ToolKernel, x: number, y: number, tipZ: number): void {
  const { cx, cy } = gridCellOfPoint(grid, x, y);
  for (const offset of kernel.offsets) {
    const index = gridCellIndex(grid, cx + offset.dx, cy + offset.dy);
    if (index === null) continue;
    const surfaceZ = tipZ + offset.dz;
    if (surfaceZ >= 0) continue;
    const current = grid.depth[index] ?? 0;
    if (surfaceZ < current) grid.depth[index] = surfaceZ;
  }
}
