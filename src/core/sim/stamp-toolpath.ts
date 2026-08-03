// computeRemovalGrid — sweep the tool kernel along a toolpath's cutting steps
// and record the deepest visit per cell (Phase H.2, ADR-098). This is the
// depth field behind the CNC preview's material-removal shading, and the
// verification instrument for every depth-producing feature after it
// (V-carve, relief): the perceptual tests compare this grid against analytic
// ground truth.
//
// Multi-bit jobs (H.7) stamp PER STEP: each cut/plunge carries the bit that
// cut it, so one ordered walk of the path leaves a v-groove where the v-bit
// ran and a flat floor where the end mill ran. Stamping per step rather than
// per tool section is what lets the scrubber's uptoLengthMm stay meaningful —
// the budget is measured along the one real path the machine runs.
//
// Pure and deterministic: the grid is allocated and filled inside this
// function — no caller-visible mutation, indexed loops only. Sampling walks
// each cut segment at half-cell spacing plus exact endpoints, so no cell the
// tool touched is skipped.
//
// Depth model: a contour step carries one flat Z (exact). A path3d step
// carries per-vertex Zs and stamps vertex-exact, interpolating linearly
// inside each segment — the same law a G1 XYZ move obeys — so non-monotone
// profiles (a valley whose endpoints sit at the surface) are represented
// faithfully. A cut step without usable per-vertex Zs (laser steps, sliced
// partials whose polyline lost the zs correspondence) falls back to one Z
// span interpolated linearly by arc length across the whole step.

import type { Toolpath, ToolpathStep } from '../job';
import type { CncTool } from '../scene';
import {
  createRemovalGrid,
  gridCellIndex,
  gridCellOfPoint,
  type RemovalGrid,
  type RemovalGridResult,
  type RemovalGridSpec,
} from './removal-grid';
import { cuttingSurfaceDz, kernelForTool, type ToolKernel } from './tool-kernels';

export type ComputeRemovalOptions = {
  // Only stamp the first `uptoLengthMm` of the toolpath — the scrubber's
  // partial-progress view. Omit for the finished cut.
  readonly uptoLengthMm?: number;
  // Multi-bit jobs (H.7): the bit each tool section cuts with, keyed by the
  // step's toolId ('' = the machine's active bit). Kernels are derived HERE,
  // from the grid's RESOLVED cell size, so a grid that coarsened itself under
  // MAX_GRID_CELLS can never be stamped with kernels sized for the requested
  // cell. A step whose key is absent from the map — and every step when the
  // map is omitted — is stamped with the `kernel` argument.
  readonly toolsByToolKey?: ReadonlyMap<string, CncTool>;
};

export type ComputeRemovalGridResult = RemovalGridResult;

export function computeRemovalGrid(
  toolpath: Toolpath,
  spec: RemovalGridSpec,
  kernel: ToolKernel,
  options: ComputeRemovalOptions = {},
): ComputeRemovalGridResult {
  const result = createRemovalGrid(spec);
  if (result.kind === 'error') return result;
  const { grid } = result;
  const kernels = kernelsByToolKey(options.toolsByToolKey, grid.mmPerCell);
  const requestedLimit = options.uptoLengthMm;
  // Treat the scrubber's 100% position as the finished cut before subtracting
  // accumulated step lengths. Otherwise floating-point cancellation can make
  // the final segment one ulp short and omit its last fixed-lattice sample.
  const limit =
    requestedLimit === undefined || requestedLimit >= toolpath.totalLength
      ? Number.POSITIVE_INFINITY
      : requestedLimit;
  let traversed = 0;
  for (const step of toolpath.steps) {
    if (traversed >= limit) break;
    const budget = limit - traversed;
    stampStep(grid, stepKernel(kernels, kernel, step), step, budget);
    traversed += step.length;
  }
  return { kind: 'ok', grid };
}

function kernelsByToolKey(
  tools: ReadonlyMap<string, CncTool> | undefined,
  mmPerCell: number,
): ReadonlyMap<string, ToolKernel> | null {
  if (tools === undefined || tools.size === 0) return null;
  const kernels = new Map<string, ToolKernel>();
  for (const [toolKey, tool] of tools) kernels.set(toolKey, kernelForTool(tool, mmPerCell));
  return kernels;
}

// Travel removes nothing, so its key never matters; cuts and plunges carry
// the bit that was in the spindle for that move.
function stepKernel(
  kernels: ReadonlyMap<string, ToolKernel> | null,
  fallback: ToolKernel,
  step: ToolpathStep,
): ToolKernel {
  if (kernels === null || step.kind === 'travel') return fallback;
  return kernels.get(step.toolId ?? '') ?? fallback;
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
  const zs = vertexZs(step);
  if (zs !== null) {
    stampCutStepVertexZ(grid, kernel, step, zs, budgetMm);
    return;
  }
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

// A per-vertex profile is usable only while one Z accompanies each vertex —
// a sliced/truncated polyline loses that correspondence and falls back to
// the endpoint span. An all-surface profile removes nothing.
function vertexZs(step: Extract<ToolpathStep, { kind: 'cut' }>): ReadonlyArray<number> | null {
  const zs = step.zs;
  if (zs === undefined || zs.length !== step.polyline.length) return null;
  let deepest = 0;
  for (const z of zs) deepest = Math.min(deepest, z);
  return deepest < 0 ? zs : null;
}

function stampCutStepVertexZ(
  grid: RemovalGrid,
  kernel: ToolKernel,
  step: Extract<ToolpathStep, { kind: 'cut' }>,
  zs: ReadonlyArray<number>,
  budgetMm: number,
): void {
  let walkedMotionMm = 0;
  for (let i = 1; i < step.polyline.length; i += 1) {
    const a = step.polyline[i - 1];
    const b = step.polyline[i];
    const zA = zs[i - 1];
    const zB = zs[i];
    if (a === undefined || b === undefined || zA === undefined || zB === undefined) continue;
    const xyLengthMm = Math.hypot(b.x - a.x, b.y - a.y);
    const motionLengthMm = Math.hypot(b.x - a.x, b.y - a.y, zB - zA);
    const done = stampSegmentVertexZ(grid, kernel, a, b, {
      xyLengthMm,
      motionLengthMm,
      walkedMotionMm,
      budgetMm,
      zA,
      zB,
    });
    if (done) return;
    walkedMotionMm += motionLengthMm;
  }
}

type VertexZSegmentParams = {
  readonly xyLengthMm: number;
  readonly motionLengthMm: number;
  readonly walkedMotionMm: number;
  readonly budgetMm: number;
  readonly zA: number;
  readonly zB: number;
};

// G1 XYZ interpolates Z linearly along the segment, so each sample lerps the
// segment's own endpoint Zs — vertex-exact where the whole-step span lerp
// cannot represent a non-monotone profile. Returns true when the scrub
// budget ran out inside this segment.
function stampSegmentVertexZ(
  grid: RemovalGrid,
  kernel: ToolKernel,
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  p: VertexZSegmentParams,
): boolean {
  const remainingMotionMm = p.budgetMm - p.walkedMotionMm;
  if (remainingMotionMm < 0) return true;
  const tLimit = p.motionLengthMm > 0 ? Math.min(1, remainingMotionMm / p.motionLengthMm) : 1;

  // A vertical move stays over one grid cell. Stamping its reached endpoint is
  // exact and monotone: a descending frontier can only deepen the cell, while
  // an ascending frontier cannot undo the already-stamped start depth.
  if (p.xyLengthMm === 0) {
    if (p.zA < 0) stampTip(grid, kernel, a.x, a.y, p.zA);
    const reachedZ = p.zA + (p.zB - p.zA) * tLimit;
    if (reachedZ < 0) stampTip(grid, kernel, a.x, a.y, reachedZ);
    return tLimit < 1;
  }

  // Use one lattice for the full 3D segment and reveal only a prefix as the
  // scrub budget advances. Re-spacing samples over [0, tLimit] would move old
  // samples between frames, allowing previously removed cells to reappear.
  // Make the 3D lattice a multiple of the established XY lattice: this bounds
  // lag on steep moves while retaining every sample in the completed grid.
  const sampleSpacing = grid.mmPerCell / 2;
  const xySamples = Math.max(1, Math.ceil(p.xyLengthMm / sampleSpacing));
  const motionSamples = Math.max(1, Math.ceil(p.motionLengthMm / sampleSpacing));
  const samples = xySamples * Math.ceil(motionSamples / xySamples);
  for (let s = 0; s <= samples; s += 1) {
    const t = s / samples;
    if (t > tLimit) return true;
    const z = p.zA + (p.zB - p.zA) * t;
    if (z < 0) stampTip(grid, kernel, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, z);
  }
  return false;
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

// Measures the cutting surface from the tool's REAL position, not from the
// centre of the cell it lands in.
//
// `kernel.offsets` carries a height precomputed from a whole-cell distance, so
// using it here quietly moved the bit to the nearest cell centre before
// cutting. On a 30 degree v-bit at 0.2 mm cells that is up to
// 0.1 / tan(15 deg) = 0.373 mm of depth error, and because the error is locked
// to the cell lattice it survives as a regular field of uncut spikes standing
// inside a groove — visible the moment the grid is fine enough to resolve a
// groove at all. The offsets stay as they are for roughing and finishing,
// which dilate on the lattice and want exactly that model.
//
// One extra ring of cells is scanned because a tip anywhere inside the centre
// cell can reach a cell whose centre sits just past the lattice radius.
function stampTip(grid: RemovalGrid, kernel: ToolKernel, x: number, y: number, tipZ: number): void {
  const { cx, cy } = gridCellOfPoint(grid, x, y);
  const reach = kernel.radiusCells + 1;
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const index = gridCellIndex(grid, cx + dx, cy + dy);
      if (index === null) continue;
      const cellX = grid.originX + (cx + dx + 0.5) * grid.mmPerCell;
      const cellY = grid.originY + (cy + dy + 0.5) * grid.mmPerCell;
      const dMm = Math.hypot(cellX - x, cellY - y);
      if (dMm > kernel.radiusMm) continue;
      const surfaceZ = tipZ + cuttingSurfaceDz(kernel.tool, dMm, kernel.radiusMm);
      if (surfaceZ >= 0) continue;
      const current = grid.depth[index] ?? 0;
      if (surfaceZ < current) grid.depth[index] = surfaceZ;
    }
  }
}
