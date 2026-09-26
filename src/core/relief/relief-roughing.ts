// reliefRoughingPasses — waterline roughing of a heightmap (Phase H.5,
// ADR-098/ADR-289). For each Z level from zPassDepths, cells whose dilated
// sampled tool-center target lies at or below the level form the region the tool
// must clear at that level; marching squares turns the region into closed
// contours, and concentric inward rings at the stepover spacing fill it.
//
// The dilation already encodes the tool's footprint, so ring 0 rides the
// region boundary directly — no additional tool-radius inset (deliberate
// deviation from pocketToolpathRings, which would double-count the radius).
//
// Output passes are contour passes in heightmap physical mm (origin at the
// heightmap's min corner, y down). The compiler has already folded object XY
// scale into that grid, so only its residual isometry and device origin remain.
// Depth-major: every ring of one level before the next. Pure and deterministic.

import { buildOffsetLadder, insetContoursChecked } from '../geometry/offset-ladder';
import { differenceClosedPolylinesChecked } from '../geometry/polygon-difference';
import { roundStrokeOutline } from '../geometry/round-stroke-outline';
import { partialDualCoordinate } from '../grid';
import type { CncContourPass, CncPass } from '../job';
import type { CncTool, Polyline } from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import { zPassDepths } from '../cnc/depth-passes';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import type { Heightmap } from './heightmap';
import { marchingSquares } from './marching-squares';

// Material intentionally left everywhere for the finishing pass (H.8).
export const DEFAULT_RELIEF_ALLOWANCE_MM = 0.5;
const LEVEL_EPS = 1e-6;
const MIN_STEPOVER_PERCENT = 10;
const MAX_RINGS_PER_LEVEL = 4096;
const MIN_RING_POINTS = 3;
// Each cleanup round traces the boundary of the stock the previous rounds
// left; a stepover up to one diameter needs one round, wider spacing a few.
const MAX_CORE_CLEANUP_ROUNDS = 4;
// Halvings of the cutter radius when finding its reach on one slice: far
// below the 0.001 mm emit grid for any cutter.
const CUT_RADIUS_BISECTIONS = 40;
// Exhausting the current 16-case marching-squares table, the farthest point on
// a produced segment from its nearest selected center occurs in cases 7/11/13/14:
// sqrt((3/4)^2 + (1/4)^2) cells. The mask kernel expands by this amount so the
// whole dual-grid contour, rather than only its sampled centers, is proven safe.
const MARCHING_SQUARES_CENTER_CLEARANCE_CELLS = Math.sqrt(10) / 4;

export type ReliefRoughingOptions = {
  readonly tool: CncTool;
  readonly reliefDepthMm: number;
  readonly depthPerPassMm: number;
  readonly stepoverPercent: number;
  readonly allowanceMm?: number;
};

export type ReliefRoughingLadder = {
  readonly passes: ReadonlyArray<CncPass>;
  // True when any level's ring ladder stopped on an offset-engine failure
  // rather than on running out of interior: that level is under-cleared and
  // the finishing skim meets stock it expected gone. Advisory only (rule 7).
  readonly offsetFailed: boolean;
  // True only when a diagnostic-only next inset proves usable interior still
  // exists beyond the emitted ring budget. Advisory only (rule 7).
  readonly passLimited: boolean;
};

export function reliefRoughingPasses(
  map: Heightmap,
  options: ReliefRoughingOptions,
): ReadonlyArray<CncPass> {
  return reliefRoughingLadder(map, options).passes;
}

// Same passes as reliefRoughingPasses, keeping the reason each level's ladder
// ended so an under-cleared level can be reported instead of shipped silently.
export function reliefRoughingLadder(
  map: Heightmap,
  options: ReliefRoughingOptions,
): ReliefRoughingLadder {
  if (!(options.reliefDepthMm > 0) || !(options.tool.diameterMm > 0)) {
    return { passes: [], offsetFailed: false, passLimited: false };
  }
  const allowanceMm = reliefAllowanceMm(options.allowanceMm);
  // ADR-412: plan with the cutter widened by the allowance plus the dual-grid
  // clearance, then lift by the allowance. Every ring point lies within that
  // clearance of a selected center, so the real cutter keeps at least the
  // allowance from the surface in 3D: on a wall as well as on a floor. The
  // widened law also covers excluded-mask stock, so no separate mask path
  // uncertainty is added.
  const kernel: ToolKernel = kernelForTool(
    options.tool,
    map.mmPerCell,
    0,
    allowanceMm + MARCHING_SQUARES_CENTER_CLEARANCE_CELLS * map.mmPerCell,
  );
  const dilated = dilateHeightmapByTool(map, kernel, allowanceMm);
  const stepMm = stepoverMm(options.stepoverPercent, options.tool.diameterMm);
  const passes: CncContourPass[] = [];
  let offsetFailed = false;
  let passLimited = false;
  const toolLaw = kernelForTool(options.tool, map.mmPerCell);
  let previousLevel = 0;
  for (const level of zPassDepths(options.reliefDepthMm, options.depthPerPassMm)) {
    const contours = levelContoursMm(map, dilated, level);
    const cutRadiusMm = sliceCutRadiusMm(toolLaw, previousLevel - level);
    const completion = appendLevelRings(passes, contours, level, stepMm, cutRadiusMm);
    offsetFailed = offsetFailed || completion.offsetFailed;
    passLimited = passLimited || completion.passLimited;
    previousLevel = level;
  }
  return { passes, offsetFailed, passLimited };
}

// How far from its path the cutter clears a whole slice: the widest radius
// whose cutting surface stays within the slice above the tip. A flat end mill
// reaches its full radius; a ball or tapered ball nose less on a thin slice,
// where a wider stepover would leave ribs the full slice tall (ADR-413).
function sliceCutRadiusMm(law: ToolKernel, sliceMm: number): number {
  const radius = law.radiusMm;
  if (law.surfaceDzAtRadius(radius) <= sliceMm) return radius;
  let low = 0;
  let high = radius;
  for (let step = 0; step < CUT_RADIUS_BISECTIONS; step += 1) {
    const middle = (low + high) / 2;
    if (law.surfaceDzAtRadius(middle) <= sliceMm) low = middle;
    else high = middle;
  }
  return low;
}

function reliefAllowanceMm(allowanceMm: number | undefined): number {
  const value = allowanceMm ?? DEFAULT_RELIEF_ALLOWANCE_MM;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function stepoverMm(stepoverPercent: number, toolDiameterMm: number): number {
  const exact =
    Number.isFinite(stepoverPercent) && stepoverPercent > 0
      ? stepoverPercent
      : MIN_STEPOVER_PERCENT;
  return (exact / 100) * toolDiameterMm;
}

// Region at a level: dilated target at or below the level (the tool must
// reach this deep here eventually — clear it now, one slice at a time).
function levelContoursMm(
  map: Heightmap,
  dilated: Float32Array,
  levelZ: number,
): ReadonlyArray<Polyline> {
  const mask = new Uint8Array(map.widthCells * map.heightCells);
  let any = false;
  for (let i = 0; i < mask.length; i += 1) {
    if (map.inclusion?.[i] !== 0 && (dilated[i] ?? 0) <= levelZ + LEVEL_EPS) {
      mask[i] = 1;
      any = true;
    }
  }
  if (!any) return [];
  return marchingSquares(mask, map.widthCells, map.heightCells).map((contour) => ({
    closed: true,
    points: contour.points.map((p) => ({
      x: partialDualCoordinate(map, 'x', p.x),
      y: partialDualCoordinate(map, 'y', p.y),
    })),
  }));
}

type ReliefLevelCompletion = {
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
};

// Keeps emitted rings fixed while distinguishing exact exhaustion, a failed
// next inset, and usable interior beyond the bounded ring budget.
function appendLevelRings(
  passes: CncContourPass[],
  contours: ReadonlyArray<Polyline>,
  levelZ: number,
  stepMm: number,
  cutRadiusMm: number,
): ReliefLevelCompletion {
  const usable = contours.filter((c) => c.points.length >= MIN_RING_POINTS);
  if (usable.length === 0) return { offsetFailed: false, passLimited: false };
  // Ring 0 = the dual-grid region boundary. The widened dilation covers every
  // point within this marching-squares table's worst displacement of a
  // selected center, so every boundary segment remains inside the proof.
  // Deeper rings shrink inward by the stepover until they vanish. Step 0's inset
  // is 0, which the offset engine returns unchanged.
  const ladder = buildOffsetLadder(usable, MAX_RINGS_PER_LEVEL, (step) => step * stepMm);
  const emitted: Polyline[] = [];
  for (const ring of ladder.rings) {
    for (const polyline of ring) {
      if (polyline.points.length < MIN_RING_POINTS) continue;
      emitted.push(polyline);
      passes.push({ kind: 'contour', zMm: levelZ, polyline: closeRing(polyline), closed: true });
    }
  }
  if (ladder.offsetFailed) return { offsetFailed: true, passLimited: false };
  if (stepMm > cutRadiusMm && !ladder.capped) {
    const cores = remainingLevelCores(usable, emitted, 2 * cutRadiusMm);
    for (const polyline of cores.toolpaths) {
      passes.push({ kind: 'contour', zMm: levelZ, polyline: closeRing(polyline), closed: true });
    }
    if (cores.offsetFailed) return { offsetFailed: true, passLimited: false };
  }
  if (!ladder.capped) return { offsetFailed: false, passLimited: false };

  // buildOffsetLadder stops immediately after its last permitted non-empty
  // ring. Probe the next inset once to classify the stop, but never append this
  // result: warning evidence may change; emitted motion must not.
  const lookahead = insetContoursChecked(usable, MAX_RINGS_PER_LEVEL * stepMm);
  if (lookahead.offsetFailed) return { offsetFailed: true, passLimited: false };
  return { offsetFailed: false, passLimited: lookahead.contours.length > 0 };
}

// ADR-413: a stepover wider than the cutter's reach can leave the last ring of a
// level (or a lobe that split off and vanished between two insets) farther
// from the region's middle than the cutter reaches, so a pillar of stock up to
// the full relief depth stands inside a level the roughing reports as cleared
// and the finishing bit plunges into it. As for pockets (ADR-098 amendment of
// 2026-09-05), subtract the cutter's actual sweep from the tool-center region
// and trace what is left, keeping the operator's ring spacing. Every traced
// boundary lies inside the region, so it inherits the rings' surface proof.
function remainingLevelCores(
  region: ReadonlyArray<Polyline>,
  emitted: ReadonlyArray<Polyline>,
  cutWidthMm: number,
): { readonly toolpaths: ReadonlyArray<Polyline>; readonly offsetFailed: boolean } {
  const toolpaths: Polyline[] = [];
  let swept: ReadonlyArray<Polyline> = emitted;
  for (let round = 0; round < MAX_CORE_CLEANUP_ROUNDS && swept.length > 0; round += 1) {
    const cleared = roundStrokeOutline(swept, cutWidthMm);
    if (cleared === null) return { toolpaths, offsetFailed: true };
    const remaining = differenceClosedPolylinesChecked(region, cleared);
    if (remaining.kind === 'error') return { toolpaths, offsetFailed: true };
    const cores = remaining.value.filter((core) => core.points.length >= MIN_RING_POINTS);
    if (cores.length === 0) break;
    const traced = cores.map((core) => ({ ...core, closed: true }));
    toolpaths.push(...traced);
    swept = [...swept, ...traced];
  }
  return { toolpaths, offsetFailed: false };
}

function closeRing(polyline: Polyline): ReadonlyArray<{ x: number; y: number }> {
  const points = polyline.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}
