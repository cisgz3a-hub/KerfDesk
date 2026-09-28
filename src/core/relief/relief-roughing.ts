// reliefRoughingPasses — waterline roughing of a heightmap (Phase H.5,
// ADR-098/ADR-289). For each Z level from zPassDepths, plus one at the floor,
// one at every flat between levels (ADR-422) and, when set, one every fine
// step on the slopes between (ADR-422 Amendment 1), cells whose dilated sampled
// tool-center target lies at or below the level form the region the tool
// must clear at that level; marching squares turns the region into closed
// contours, and concentric inward rings at the stepover spacing fill it.
//
// The dilation already encodes the tool's footprint, so ring 0 rides the
// region boundary directly — no additional tool-radius inset (deliberate
// deviation from pocketToolpathRings, which would double-count the radius).
// The stepover is a percentage of the cut width over one level, which is the
// stored diameter for a flat end mill. A ball nose, V-bit, engraving bit or
// tapered ball nose cuts narrower on a level shallower than it narrows, and its
// rings then overlap inside every level instead of leaving ribs (ADR-368
// Amendments 2 and 3). When the stepover is wider than the cutter reaches on a
// level's slice (ADR-413), the innermost ring can stop short of the level's
// centre; relief-core-cleanup.ts then adds the paths that clear what the rings
// leave, as the pocket planner does (ADR-289 Amendment 1).
//
// Output passes are contour passes in heightmap physical mm (origin at the
// heightmap's min corner, y down), each ring closed back to its first point.
// The compiler has already folded object XY scale into that grid, so only its
// residual isometry and device origin remain. Depth-major: every ring of one
// level, cleanup first then inside out, before the next level. With flat
// finishing on (ADR-450), an end mill then cuts each flat of the model to its
// exact height, top down (relief-flat-finish.ts). Pure and deterministic.

import { withOuterContoursPositive } from '../geometry/polyline-orientation';
import { buildOffsetLadder, insetContoursChecked } from '../geometry/offset-ladder';
import type { CncContourPass, CncPass } from '../job';
import type { CncTool, Polyline } from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import { zPassDepths } from '../cnc/depth-passes';
import { cncLayoutCutWidths } from '../cnc/layout-cut-widths';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import type { Heightmap } from './heightmap';
import { reliefCoreCleanup } from './relief-core-cleanup';
import {
  finishedFlatDepths,
  maskContoursMm,
  mergeFlatLevels,
  reliefFlatLevels,
  type ReliefFinishedFlats,
} from './relief-flat-finish';
import { reliefRoughingLevels, type ReliefRoughingLevel } from './relief-roughing-levels';
import type { ReliefRoughingLevelPaths } from './relief-roughing-motion';
import { flatFinishingStepPlans, type FlatFinishingStepPlan } from './relief-flat-finish-steps';

// Material intentionally left everywhere for the finishing pass (H.8).
export const DEFAULT_RELIEF_ALLOWANCE_MM = 0.5;
const LEVEL_EPS = 1e-6;
const MIN_STEPOVER_PERCENT = 10;
const MAX_RINGS_PER_LEVEL = 4096;
const MIN_RING_POINTS = 3;
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
  // ADR-422 Amendment 1: band levels this far apart between the depth-per-pass
  // levels, so slopes keep smaller terraces. Absent = none.
  readonly fineStepMm?: number;
  // ADR-450: an end mill also cuts every flat of the model to its height.
  readonly finishFlats?: boolean;
};

export type ReliefRoughingLadder = {
  // Every ring and cleanup path as a closed contour pass, level by level.
  readonly passes: ReadonlyArray<CncPass>;
  // The same paths per level with the region that proves them, for
  // relief-roughing-motion.ts to order, link and enter (ADR-424).
  readonly levels: ReadonlyArray<ReliefRoughingLevelPaths>;
  // The width one ring clears, which the stepover is a percentage of.
  readonly cutWidthMm: number;
  // True when any level's ring ladder stopped on an offset-engine failure
  // rather than on running out of interior: that level is under-cleared and
  // the finishing skim meets stock it expected gone. Advisory only (rule 7).
  readonly offsetFailed: boolean;
  // True only when a diagnostic-only next inset proves usable interior still
  // exists beyond the emitted ring budget. Advisory only (rule 7).
  readonly passLimited: boolean;
  // ADR-450: where the flat levels left the model's exact height, for the
  // finishing ball to skip. Absent when flat finishing is off.
  readonly finishedFlats?: ReliefFinishedFlats;
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
    return { passes: [], levels: [], cutWidthMm: 0, offsetFailed: false, passLimited: false };
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
  const { clearingDiameterMm } = cncLayoutCutWidths(
    options.tool,
    options.reliefDepthMm,
    options.depthPerPassMm,
  );
  const stepMm = stepoverMm(options.stepoverPercent, clearingDiameterMm);
  const context: LevelContext = {
    map,
    dilated,
    stepMm,
    toolLaw: kernelForTool(options.tool, map.mmPerCell),
  };
  // ADR-422: the ladder plus a level at the floor and at every flat, and with
  // its Amendment 1 at every fine step on the slopes between.
  const levels = reliefRoughingLevels(
    map,
    dilated,
    zPassDepths(options.reliefDepthMm, options.depthPerPassMm),
    clearingDiameterMm / 2,
    options.fineStepMm,
  );
  const flats =
    options.finishFlats === true && options.tool.kind === 'end-mill'
      ? flatPlan(map, kernel, dilated, levels, allowanceMm, options.depthPerPassMm)
      : null;
  const completions: ReliefLevelCompletion[] = [];
  const finished: FinishedCut[] = [];
  levels.forEach((level, index) => {
    // ADR-450: a level one allowance above a flat may cut straight to it.
    const planned = planRoughingLevel(context, level, flats?.cutZMm.get(index));
    completions.push(planned.completion);
    if (planned.finished !== null) finished.push(planned.finished);
  });
  if (flats !== null) {
    const separate = planFlatLevels(
      map,
      flats,
      options.depthPerPassMm,
      stepMm,
      options.tool.diameterMm / 2,
    );
    for (const completion of separate.completions) completions.push(completion);
    for (const flat of separate.finished) finished.push(flat);
  }
  return {
    ...ladderOf(completions, context.toolLaw.surfaceDzAtRadius(context.toolLaw.radiusMm)),
    cutWidthMm: clearingDiameterMm,
    ...(flats === null
      ? {}
      : { finishedFlats: finishedFlatDepths(map, finished, options.tool.diameterMm / 2) }),
  };
}

type LevelContext = {
  readonly map: Heightmap;
  readonly dilated: Float32Array;
  readonly stepMm: number;
  readonly toolLaw: ToolKernel;
};

// A cut that took the model's flat to its height, and the tip cells it swept.
type FinishedCut = { readonly zMm: number; readonly mask: Uint8Array };

// One roughing level's rings and core cleanup, cut at `cutZMm` when ADR-450
// folds a flat into it.
function planRoughingLevel(
  context: LevelContext,
  level: ReliefRoughingLevel,
  cutZMm: number | undefined,
): { readonly completion: ReliefLevelCompletion; readonly finished: FinishedCut | null } {
  const { map, dilated } = context;
  const mask = levelMask(map, dilated, level.zMm, level.bandFloorMm);
  const contours = mask === null ? [] : maskContoursMm(map, mask);
  const reach =
    level.bandFloorMm === null ? contours : levelContoursMm(map, dilated, level.zMm, null);
  const cut = cutZMm === undefined ? level : { ...level, zMm: cutZMm };
  const cutRadiusMm = sliceCutRadiusMm(context.toolLaw, cut.sliceTopMm - cut.zMm);
  const completion = planLevel(contours, reach, cut, context.stepMm, cutRadiusMm);
  const finished =
    cutZMm !== undefined && mask !== null && levelCompleted(completion)
      ? { zMm: cutZMm, mask }
      : null;
  return { completion, finished };
}

// Every planned level's closed passes and paths, and whether any stopped short.
function ladderOf(
  completions: ReadonlyArray<ReliefLevelCompletion>,
  toolRiseMm: number,
): Pick<ReliefRoughingLadder, 'passes' | 'levels' | 'offsetFailed' | 'passLimited'> {
  const passes: CncContourPass[] = [];
  const levels: ReliefRoughingLevelPaths[] = [];
  let aboveCleared = true;
  for (const completion of completions) {
    if (completion.paths !== null) {
      const floor = aboveCleared ? airFloorMm(completion.paths, toolRiseMm) : null;
      levels.push(floor === null ? completion.paths : { ...completion.paths, airFloorZMm: floor });
      appendClosedRings(passes, completion.paths);
    }
    if (completion.offsetFailed || completion.passLimited) aboveCleared = false;
  }
  return {
    passes,
    levels,
    offsetFailed: completions.some((completion) => completion.offsetFailed),
    passLimited: completions.some((completion) => completion.passLimited),
  };
}

// ADR-489: the air a level's paths may be entered through: its slice top
// plus the cutter's rise at its full radius, where every earlier cut at or
// below the slice top leaves the stock. It is a candidate: each pass keeps it
// only where the passes before it swept everything within the cutter's radius
// of its path (ADR-489 Amendment 1, relief-air-floor-proof.ts). A level cut
// from the uncut stock top, or below a level that stopped short, has none.
function airFloorMm(level: ReliefRoughingLevelPaths, toolRiseMm: number): number | null {
  if (!(level.sliceTopMm < -LEVEL_EPS) || !Number.isFinite(toolRiseMm)) return null;
  return level.sliceTopMm + Math.max(0, toolRiseMm);
}

type FlatPlan = {
  // The zero-lift tip field: the widened cutter, not lifted.
  readonly tip: Float32Array;
  readonly cutZMm: ReadonlyMap<number, number>;
  readonly separate: ReadonlyArray<FlatFinishingStepPlan>;
};

// ADR-450: the model's flats, each taken by the roughing level one allowance
// above it where the depth per pass allows, or else left for its own level.
function flatPlan(
  map: Heightmap,
  kernel: ToolKernel,
  roughingTip: Float32Array,
  levels: ReadonlyArray<ReliefRoughingLevel>,
  allowanceMm: number,
  depthPerPassMm: number,
): FlatPlan {
  const tip = dilateHeightmapByTool(map, kernel, 0);
  const flats = reliefFlatLevels(map, tip, kernel.radiusMm - kernel.horizontalGrowthMm);
  const merged = mergeFlatLevels(levels, flats, allowanceMm, depthPerPassMm);
  return {
    tip,
    cutZMm: merged.cutZMm,
    separate: flatFinishingStepPlans(merged.separate, levels, roughingTip, depthPerPassMm),
  };
}

function levelCompleted(completion: ReliefLevelCompletion): boolean {
  return completion.paths !== null && !completion.offsetFailed && !completion.passLimited;
}

// ADR-450: a level of its own at each flat no roughing level took, after
// every roughing level. Only a level whose rings and cleanup completed counts
// as finished.
function planFlatLevels(
  map: Heightmap,
  plan: FlatPlan,
  depthPerPassMm: number,
  stepMm: number,
  toolRadiusMm: number,
): {
  readonly completions: ReadonlyArray<ReliefLevelCompletion>;
  readonly finished: ReadonlyArray<FinishedCut>;
} {
  const completions: ReliefLevelCompletion[] = [];
  const finished: FinishedCut[] = [];
  for (const entry of plan.separate) {
    const { flat } = entry;
    let sliceTopMm = entry.sliceTopMm;
    const reach = levelContoursMm(map, plan.tip, flat.zMm, null);
    const depths = zPassDepths(sliceTopMm - flat.zMm, depthPerPassMm);
    for (const [index, depth] of depths.entries()) {
      const zMm = index === depths.length - 1 ? flat.zMm : entry.sliceTopMm + depth;
      const level = { zMm, bandFloorMm: null, sliceTopMm };
      const completion = planLevel(flat.contours, reach, level, stepMm, toolRadiusMm);
      completions.push(completion);
      if (index === depths.length - 1 && levelCompleted(completion)) finished.push(flat);
      sliceTopMm = zMm;
    }
  }
  return { completions, finished };
}

function appendClosedRings(passes: CncContourPass[], level: ReliefRoughingLevelPaths): void {
  const insideOut = [
    ...[...level.cleanup].reverse(),
    ...[...level.rings].reverse().flatMap(withOuterContoursPositive),
  ];
  for (const polyline of insideOut) {
    passes.push({ kind: 'contour', zMm: level.zMm, polyline: closeRing(polyline), closed: true });
  }
}

// How far from its path the cutter clears a whole slice: the widest radius
// whose cutting surface stays within the slice above the tip. A flat end mill
// reaches its full radius; a ball or tapered ball nose less on a thin slice,
// where a wider stepover would leave ribs the full slice tall (ADR-413). The
// core cleanup sizes every ring's sweep by it (ADR-289 Amendment 1).
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
// reach this deep here eventually — clear it now, one slice at a time). A flat
// level's band stops above the next level, which clears the rest (ADR-422).
function levelContoursMm(
  map: Heightmap,
  dilated: Float32Array,
  levelZ: number,
  bandFloorZ: number | null,
): ReadonlyArray<Polyline> {
  const mask = levelMask(map, dilated, levelZ, bandFloorZ);
  return mask === null ? [] : maskContoursMm(map, mask);
}

function levelMask(
  map: Heightmap,
  dilated: Float32Array,
  levelZ: number,
  bandFloorZ: number | null,
): Uint8Array | null {
  const mask = new Uint8Array(map.widthCells * map.heightCells);
  const floor = bandFloorZ === null ? Number.NEGATIVE_INFINITY : bandFloorZ + LEVEL_EPS;
  let any = false;
  for (let i = 0; i < mask.length; i += 1) {
    const tip = dilated[i] ?? 0;
    if (map.inclusion?.[i] !== 0 && tip <= levelZ + LEVEL_EPS && tip > floor) {
      mask[i] = 1;
      any = true;
    }
  }
  if (!any) return null;
  if (bandFloorZ !== null) growBand(map, dilated, mask, levelZ);
  return mask;
}

// Where a band is steeper than one cell per level, it breaks into single cells
// with gaps where the tip steps over it. Growing it one cell into the deeper
// cells around it, where the cutter may stand at this depth too and the stock
// stands no higher, joins those into one strip (ADR-422 Amendment 1).
function growBand(map: Heightmap, dilated: Float32Array, mask: Uint8Array, levelZ: number): void {
  const { widthCells, heightCells } = map;
  const band = mask.slice();
  for (let y = 0; y < heightCells; y += 1) {
    for (let x = 0; x < widthCells; x += 1) {
      const index = y * widthCells + x;
      if (band[index] === 1 || map.inclusion?.[index] === 0) continue;
      if (!((dilated[index] ?? 0) <= levelZ + LEVEL_EPS)) continue;
      if (touchesBand(band, widthCells, heightCells, x, y)) mask[index] = 1;
    }
  }
}

function touchesBand(band: Uint8Array, width: number, height: number, x: number, y: number) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && band[ny * width + nx] === 1) {
        return true;
      }
    }
  }
  return false;
}

type ReliefLevelCompletion = {
  readonly paths: ReliefRoughingLevelPaths | null;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
};

// Keeps emitted rings fixed while distinguishing exact exhaustion, a failed
// next inset, and usable interior beyond the bounded ring budget.
function planLevel(
  contours: ReadonlyArray<Polyline>,
  reach: ReadonlyArray<Polyline>,
  level: ReliefRoughingLevel,
  stepMm: number,
  cutRadiusMm: number,
): ReliefLevelCompletion {
  const usable = contours.filter((c) => c.points.length >= MIN_RING_POINTS);
  if (usable.length === 0) return { paths: null, offsetFailed: false, passLimited: false };
  // Ring 0 = the dual-grid region boundary. The widened dilation covers every
  // point within this marching-squares table's worst displacement of a
  // selected center, so every boundary segment remains inside the proof.
  // Deeper rings shrink inward by the stepover until they vanish. Step 0's inset
  // is 0, which the offset engine returns unchanged.
  const ladder = buildOffsetLadder(usable, MAX_RINGS_PER_LEVEL, (step) => step * stepMm);
  const cleanup = reliefCoreCleanup(usable, ladder, stepMm, cutRadiusMm);
  const kept = cleanup.paths.flatMap((path, index) =>
    path.points.length < MIN_RING_POINTS ? [] : [index],
  );
  const paths: ReliefRoughingLevelPaths = {
    zMm: level.zMm,
    sliceTopMm: level.sliceTopMm,
    region: usable,
    linkRegion:
      reach === contours ? usable : reach.filter((c) => c.points.length >= MIN_RING_POINTS),
    rings: ladder.rings.map((ring) => ring.filter((p) => p.points.length >= MIN_RING_POINTS)),
    cleanup: kept.map((index) => cleanup.paths[index] as Polyline),
    cleanupStockInside: kept.map((index) => cleanup.stockInside[index] ?? false),
  };
  const offsetFailed = ladder.offsetFailed || cleanup.offsetFailed;
  if (offsetFailed) return { paths, offsetFailed, passLimited: false };
  if (!ladder.capped) return { paths, offsetFailed, passLimited: cleanup.passLimited };

  // buildOffsetLadder stops immediately after its last permitted non-empty
  // ring. Probe the next inset once to classify the stop, but never append this
  // result: warning evidence may change; emitted motion must not.
  const lookahead = insetContoursChecked(usable, MAX_RINGS_PER_LEVEL * stepMm);
  if (lookahead.offsetFailed) return { paths, offsetFailed: true, passLimited: false };
  return { paths, offsetFailed: false, passLimited: lookahead.contours.length > 0 };
}

function closeRing(polyline: Polyline): ReadonlyArray<{ x: number; y: number }> {
  const points = polyline.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}
