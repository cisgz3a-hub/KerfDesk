// reliefRoughingPasses — waterline roughing of a heightmap (Phase H.5,
// ADR-098). For each Z level from zPassDepths, cells whose dilated (safe
// tool-center) target lies at or below the level form the region the tool
// must clear at that level; marching squares turns the region into closed
// contours, and concentric inward rings at the stepover spacing fill it.
//
// The dilation already encodes the tool's footprint, so ring 0 rides the
// region boundary directly — no additional tool-radius inset (deliberate
// deviation from pocketToolpathRings, which would double-count the radius).
//
// Output passes are contour passes in HEIGHTMAP-LOCAL mm (origin at the
// heightmap's min corner, y down); the compiler maps them through the
// object transform and the device origin. Depth-major: every ring of one
// level before the next level down. Pure and deterministic.

import { buildOffsetLadder } from '../geometry/offset-ladder';
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
const MAX_STEPOVER_PERCENT = 85;
const MAX_RINGS_PER_LEVEL = 4096;
const MIN_RING_POINTS = 3;

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
    return { passes: [], offsetFailed: false };
  }
  const kernel: ToolKernel = kernelForTool(options.tool, map.mmPerCell);
  const dilated = dilateHeightmapByTool(
    map,
    kernel,
    options.allowanceMm ?? DEFAULT_RELIEF_ALLOWANCE_MM,
  );
  const stepMm = stepoverMm(options.stepoverPercent, options.tool.diameterMm);
  const passes: CncContourPass[] = [];
  let offsetFailed = false;
  for (const level of zPassDepths(options.reliefDepthMm, options.depthPerPassMm)) {
    const contours = levelContoursMm(map, dilated, level);
    if (appendLevelRings(passes, contours, level, stepMm)) offsetFailed = true;
  }
  return { passes, offsetFailed };
}

function stepoverMm(stepoverPercent: number, toolDiameterMm: number): number {
  const clamped = Number.isFinite(stepoverPercent)
    ? Math.min(MAX_STEPOVER_PERCENT, Math.max(MIN_STEPOVER_PERCENT, stepoverPercent))
    : MIN_STEPOVER_PERCENT;
  return (clamped / 100) * toolDiameterMm;
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
    if ((dilated[i] ?? 0) <= levelZ + LEVEL_EPS) {
      mask[i] = 1;
      any = true;
    }
  }
  if (!any) return [];
  return marchingSquares(mask, map.widthCells, map.heightCells).map((contour) => ({
    closed: true,
    points: contour.points.map((p) => ({ x: p.x * map.mmPerCell, y: p.y * map.mmPerCell })),
  }));
}

// Returns true when this level's ladder was cut short by an offset-engine
// failure (see offset-ladder.ts) rather than by the region running out.
function appendLevelRings(
  passes: CncContourPass[],
  contours: ReadonlyArray<Polyline>,
  levelZ: number,
  stepMm: number,
): boolean {
  const usable = contours.filter((c) => c.points.length >= MIN_RING_POINTS);
  if (usable.length === 0) return false;
  // Ring 0 = the region boundary itself (tool-center-safe by construction);
  // deeper rings shrink inward by the stepover until they vanish. Step 0's
  // inset is 0, which the offset engine returns unchanged, so ring 0 is still
  // exactly `usable`.
  const ladder = buildOffsetLadder(usable, MAX_RINGS_PER_LEVEL, (step) => step * stepMm);
  for (const ring of ladder.rings) {
    for (const polyline of ring) {
      if (polyline.points.length < MIN_RING_POINTS) continue;
      passes.push({ kind: 'contour', zMm: levelZ, polyline: closeRing(polyline), closed: true });
    }
  }
  return ladder.offsetFailed;
}

function closeRing(polyline: Polyline): ReadonlyArray<{ x: number; y: number }> {
  const points = polyline.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}
