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
import { kernelForTool, type ToolKernel } from './tool-kernels';

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
  const limit = options.uptoLengthMm ?? Number.POSITIVE_INFINITY;
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
  let walked = 0;
  for (let i = 1; i < step.polyline.length; i += 1) {
    const a = step.polyline[i - 1];
    const b = step.polyline[i];
    const zA = zs[i - 1];
    const zB = zs[i];
    if (a === undefined || b === undefined || zA === undefined || zB === undefined) continue;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const done = stampSegmentVertexZ(grid, kernel, a, b, { segLen, walked, budgetMm, zA, zB });
    if (done) return;
    walked += segLen;
  }
}

type VertexZSegmentParams = {
  readonly segLen: number;
  readonly walked: number;
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
  const sampleSpacing = grid.mmPerCell / 2;
  const samples = Math.max(1, Math.ceil(p.segLen / sampleSpacing));
  for (let s = 0; s <= samples; s += 1) {
    const t = s / samples;
    if (p.walked + p.segLen * t > p.budgetMm) return true;
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
