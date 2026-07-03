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

import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
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

export function reliefRoughingPasses(
  map: Heightmap,
  options: ReliefRoughingOptions,
): ReadonlyArray<CncPass> {
  if (!(options.reliefDepthMm > 0) || !(options.tool.diameterMm > 0)) return [];
  const kernel: ToolKernel = kernelForTool(options.tool, map.mmPerCell);
  const dilated = dilateHeightmapByTool(
    map,
    kernel,
    options.allowanceMm ?? DEFAULT_RELIEF_ALLOWANCE_MM,
  );
  const stepMm = stepoverMm(options.stepoverPercent, options.tool.diameterMm);
  const passes: CncContourPass[] = [];
  for (const level of zPassDepths(options.reliefDepthMm, options.depthPerPassMm)) {
    const contours = levelContoursMm(map, dilated, level);
    appendLevelRings(passes, contours, level, stepMm);
  }
  return passes;
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

function appendLevelRings(
  passes: CncContourPass[],
  contours: ReadonlyArray<Polyline>,
  levelZ: number,
  stepMm: number,
): void {
  const usable = contours.filter((c) => c.points.length >= MIN_RING_POINTS);
  if (usable.length === 0) return;
  // Ring 0 = the region boundary itself (tool-center-safe by construction);
  // deeper rings shrink inward by the stepover until they vanish.
  for (let k = 0; k < MAX_RINGS_PER_LEVEL; k += 1) {
    const ring = k === 0 ? usable : offsetClosedPolylinesForKerf(usable, -(k * stepMm));
    if (ring.length === 0) break;
    for (const polyline of ring) {
      if (polyline.points.length < MIN_RING_POINTS) continue;
      passes.push({ kind: 'contour', zMm: levelZ, polyline: closeRing(polyline), closed: true });
    }
  }
}

function closeRing(polyline: Polyline): ReadonlyArray<{ x: number; y: number }> {
  const points = polyline.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}
