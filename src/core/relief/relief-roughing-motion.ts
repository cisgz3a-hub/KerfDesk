// reliefRoughingMotion — how relief roughing moves between and into its
// rings (ADR-424). The ring ladder and core cleanup decide where the cutter
// goes; this decides the order, the direction and the entry:
//
// - Order: each level's pieces inside out (relief-roughing-order.ts), taking
//   of the pieces whose inner pieces are all cut the one nearest the cutter,
//   after that level's deepest-first core cleanup paths (ADR-427).
// - Direction: every loop keeps the stock it cuts on the side the layer's cut
//   direction asks for, islands and cleanup traces included.
// - Links: after a loop the cutter stays down and feeds straight to the
//   nearest point of the next loop when that move is no longer than one cut
//   width and stays inside the level's link region, where the dilated
//   heightmap proves the cutter may stand at that depth and the stock stands
//   no higher than the level's own. Between the loops of one piece (its outer
//   contour and its islands) a link of any length stays down if it stays in
//   the piece, whose inner pieces are already cut. Otherwise it lifts.
// - Entry: with a ramp angle set, a chain's first loop is entered by
//   descending along it from the level above (the stock there is already
//   cleared) instead of plunging, wrapping round the loop as often as the
//   angle needs. A loop shorter than one cut width is too tight to ramp round
//   and is plunged; its pass is marked `entryPlunge`, which the G-code header
//   and Job Review disclose (ADR-424 Amendment 1).
// - Moves: vertices on the straight line between their neighbours (a
//   staircase ring's cell-by-cell runs, a ramp's along one side) are dropped,
//   so each straight run is one move; the path is unchanged (ADR-488).
// - Air floors: a pass keeps its level's air floor only when the passes cut
//   before it repeated the same complete path with the same output primitive
//   (ADR-489 Amendment 1, relief-air-floor-proof.ts).
//
// Everything stays in heightmap mm; the compiler maps it to the machine.

import type { CncPass, CncPath3dPass } from '../job';
import type { Vec3 } from '../geometry/vec3';
import { dropCollinearPoints } from '../geometry/drop-collinear-points';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { pointInPolygon } from '../geometry/point-in-polygon';
import type { Polyline, Vec2 } from '../scene';
import { keepProvenAirFloors } from './relief-air-floor-proof';
import { insideOutNearest, openLoop, ringPieces, type RoughingLoop } from './relief-roughing-order';

const MIN_LOOP_POINTS = 3;
const MIN_RAMP_ANGLE_DEG = 0.5;
const MAX_RAMP_ANGLE_DEG = 45;
// A link endpoint may sit on the region boundary itself (ring 0 is that
// boundary), so the crossing test ignores this much of each end.
const LINK_END_TRIM_MM = 1e-6;

export type ReliefRoughingLevelPaths = {
  readonly zMm: number;
  // Where the stock under this level's region stands before the level cuts.
  readonly sliceTopMm: number;
  // The level's tool-center region: every point inside it is proven.
  readonly region: ReadonlyArray<Polyline>;
  // Where a link at depth may pass: the region itself, or for a band level
  // (ADR-422) every cell its depth reaches, the deeper ones included. Their
  // stock stands at the band's slice top too, so a link through them cuts no
  // deeper a slice than the band's own loops.
  readonly linkRegion: ReadonlyArray<Polyline>;
  // The ring ladder, one entry per inset step, outermost first.
  readonly rings: ReadonlyArray<ReadonlyArray<Polyline>>;
  // Core cleanup paths and, for each, whether its stock lies inside it.
  readonly cleanup: ReadonlyArray<Polyline>;
  readonly cleanupStockInside: ReadonlyArray<boolean>;
  // ADR-489: the level's air floor, its slice top plus the cutter's rise at
  // its full radius; absent when the ladder rules it out. Each pass keeps it
  // only when the passes before it prove it (ADR-489 Amendment 1).
  readonly airFloorZMm?: number;
};

export type ReliefRoughingMotionOptions = {
  // True when the stock should lie right of travel in heightmap numbers:
  // climb, unless the placement or the machine frame mirrors the map.
  readonly stockOnRight: boolean;
  // Longest link at depth; also the shortest loop a ramp wraps round.
  readonly cutWidthMm: number;
  // Ramp entry angle in degrees; absent or not positive plunges.
  readonly rampAngleDeg?: number;
  // The cutter's radius, which proves each pass's air floor against the
  // passes cut before it. Absent: no pass keeps a floor.
  readonly cutterRadiusMm?: number;
};

type Chain = {
  readonly zMm: number;
  readonly airFloorZMm: number | undefined;
  // The entry ramp, descending to zMm; empty when the chain plunges.
  readonly ramp: ReadonlyArray<Vec3>;
  // True when a ramp angle is set but the first loop is too tight to ramp
  // round, so the chain plunges anyway.
  readonly entryPlunge: boolean;
  // Everything at depth, from the ramp's end (or the plunge) onward.
  readonly path: Vec2[];
};

/** Contour passes (or ramped path3d passes) that cut every level's loops. */
export function reliefRoughingMotion(
  levels: ReadonlyArray<ReliefRoughingLevelPaths>,
  options: ReliefRoughingMotionOptions,
): ReadonlyArray<CncPass> {
  const passes: CncPass[] = [];
  const ceilings: Array<number | null> = [];
  for (const level of levels) {
    appendLevel(passes, level, options);
    const ceiling = level.airFloorZMm === undefined ? null : level.sliceTopMm;
    while (ceilings.length < passes.length) ceilings.push(ceiling);
  }
  return keepProvenAirFloors(passes, ceilings, options.cutterRadiusMm ?? 0);
}

function appendLevel(
  passes: CncPass[],
  level: ReliefRoughingLevelPaths,
  options: ReliefRoughingMotionOptions,
): void {
  const region = level.linkRegion.map((contour) => openLoop(contour.points));
  let chain: Chain | null = null;
  const cut = (group: ReadonlyArray<RoughingLoop>): void => {
    // Inside the piece, the pieces within it are cut already: a link between
    // its own loops that stays in it crosses cleared floor, however long.
    const piece = group.map((loop) => loop.points);
    nearestFirst(group, chainEnd(chain)).forEach((loop, index) => {
      const oriented = orient(loop, options.stockOnRight);
      if (
        chain !== null &&
        (extendChain(chain, oriented, region, options.cutWidthMm) ||
          (index > 0 && extendChain(chain, oriented, piece, Number.POSITIVE_INFINITY)))
      ) {
        return;
      }
      if (chain !== null) passes.push(chainPass(chain));
      chain = openChain(oriented, level, options);
    });
  };
  for (const group of [...cleanupGroups(level)].reverse()) cut(group);
  const next = insideOutNearest(ringPieces(level.rings), loopDistance);
  for (let piece = next(undefined); piece !== undefined; piece = next(chainEnd(chain))) {
    cut(piece.loops);
  }
  if (chain !== null) passes.push(chainPass(chain));
}

function chainEnd(chain: Chain | null): Vec2 | undefined {
  return chain?.path[chain.path.length - 1];
}

// Stay down into the next loop when the link to its nearest point is clear.
function extendChain(
  chain: Chain,
  loop: ReadonlyArray<Vec2>,
  region: ReadonlyArray<ReadonlyArray<Vec2>>,
  cutWidthMm: number,
): boolean {
  const from = chainEnd(chain);
  const start = from === undefined ? null : nearestOnLoop(loop, from);
  if (from === undefined || start === null) return false;
  if (!linkIsClear(from, start.point, region, cutWidthMm)) return false;
  for (const point of loopFrom(loop, start)) pushDistinct(chain.path, point);
  return true;
}

function cleanupGroups(
  level: ReliefRoughingLevelPaths,
): ReadonlyArray<ReadonlyArray<RoughingLoop>> {
  return level.cleanup.map((path, index) => [
    { points: openLoop(path.points), stockInside: level.cleanupStockInside[index] ?? false },
  ]);
}

// A piece's own loops (its outer contour and its islands), each next one the
// nearest to where the cutter will be. Every loop ends where it starts, at
// the point nearest the cutter.
function nearestFirst(
  group: ReadonlyArray<RoughingLoop>,
  from: Vec2 | undefined,
): ReadonlyArray<RoughingLoop> {
  const left = group.filter((loop) => loop.points.length >= MIN_LOOP_POINTS);
  if (from === undefined || left.length < 2) return left;
  const ordered: RoughingLoop[] = [];
  let at = from;
  while (left.length > 0) {
    let best = 0;
    let bestPoint: LoopPoint | null = null;
    for (let index = 0; index < left.length; index += 1) {
      const near = nearestOnLoop((left[index] as RoughingLoop).points, at);
      if (near !== null && (bestPoint === null || near.distance < bestPoint.distance)) {
        bestPoint = near;
        best = index;
      }
    }
    const [next] = left.splice(best, 1);
    if (next === undefined) break;
    ordered.push(next);
    if (bestPoint !== null) at = bestPoint.point;
  }
  return ordered;
}

// Stock right of travel means the loop's inside is on the right when its stock
// is inside, which a negative signed area gives, and on the left otherwise.
function orient(loop: RoughingLoop, stockOnRight: boolean): ReadonlyArray<Vec2> {
  const wantPositive = loop.stockInside !== stockOnRight;
  const positive = signedAreaMm2(loop.points) > 0;
  return positive === wantPositive ? loop.points : [...loop.points].reverse();
}

type LoopPoint = {
  readonly segment: number;
  readonly point: Vec2;
  readonly distance: number;
};

function nearestOnLoop(points: ReadonlyArray<Vec2>, from: Vec2): LoopPoint | null {
  let best: LoopPoint | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index] as Vec2;
    const b = points[(index + 1) % points.length] as Vec2;
    const point = closestOnSegment(a, b, from);
    const distance = Math.hypot(point.x - from.x, point.y - from.y);
    if (best === null || distance < best.distance) best = { segment: index, point, distance };
  }
  return best;
}

function loopDistance(points: ReadonlyArray<Vec2>, from: Vec2): number {
  return nearestOnLoop(points, from)?.distance ?? Number.POSITIVE_INFINITY;
}

function closestOnSegment(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return a;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

// The whole loop from a point on it, back to that point.
function loopFrom(points: ReadonlyArray<Vec2>, start: LoopPoint): Vec2[] {
  const out: Vec2[] = [start.point];
  for (let step = 1; step <= points.length; step += 1) {
    const vertex = points[(start.segment + step) % points.length] as Vec2;
    pushDistinct(out, vertex);
  }
  pushDistinct(out, start.point);
  return out;
}

function pushDistinct(out: Vec2[], point: Vec2): void {
  const last = out[out.length - 1];
  if (last === undefined || last.x !== point.x || last.y !== point.y) out.push(point);
}

// A link must be short (it may cross stock the next loop has not cut yet)
// and must not leave the proven region: no crossing of its boundary, and its
// middle inside it.
function linkIsClear(
  from: Vec2,
  to: Vec2,
  region: ReadonlyArray<ReadonlyArray<Vec2>>,
  maxLengthMm: number,
): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length > maxLengthMm) return false;
  if (length <= 2 * LINK_END_TRIM_MM) return true;
  const trim = LINK_END_TRIM_MM / length;
  const a = lerp(from, to, trim);
  const b = lerp(from, to, 1 - trim);
  for (const contour of region) {
    for (let index = 0; index < contour.length; index += 1) {
      const c = contour[index] as Vec2;
      const d = contour[(index + 1) % contour.length] as Vec2;
      if (segmentsCross(a, b, c, d)) return false;
    }
  }
  const middle = lerp(from, to, 0.5);
  return region.filter((contour) => pointInPolygon(middle, contour)).length % 2 === 1;
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)) {
    return false;
  }
  if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) {
    return false;
  }
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0);
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// A new chain: plunge at the middle of the loop's longest side, or ramp in
// from the level above along the loop.
function openChain(
  points: ReadonlyArray<Vec2>,
  level: ReliefRoughingLevelPaths,
  options: ReliefRoughingMotionOptions,
): Chain {
  const start = longestSideMiddle(points);
  const drop = level.sliceTopMm - level.zMm;
  const angle = options.rampAngleDeg ?? 0;
  const airFloorZMm = level.airFloorZMm;
  if (!(angle > 0) || !(drop > 0)) {
    return {
      zMm: level.zMm,
      airFloorZMm,
      ramp: [],
      entryPlunge: false,
      path: loopFrom(points, start),
    };
  }
  const perimeter = perimeterMm(points);
  if (!(perimeter > 0) || !(perimeter >= options.cutWidthMm)) {
    // The cutter covers the whole loop wherever it stands on it, so laps
    // would only slow the plunge; the pass says it plunged instead.
    return {
      zMm: level.zMm,
      airFloorZMm,
      ramp: [],
      entryPlunge: true,
      path: loopFrom(points, start),
    };
  }
  const clamped = Math.min(Math.max(angle, MIN_RAMP_ANGLE_DEG), MAX_RAMP_ANGLE_DEG);
  const ramp = rampAlong(points, start, level.sliceTopMm, level.zMm, (clamped * Math.PI) / 180);
  return {
    zMm: level.zMm,
    airFloorZMm,
    ramp: ramp.points,
    entryPlunge: false,
    path: loopFrom(points, ramp.end),
  };
}

function longestSideMiddle(points: ReadonlyArray<Vec2>): LoopPoint {
  let best: LoopPoint = { segment: 0, point: points[0] as Vec2, distance: -1 };
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index] as Vec2;
    const b = points[(index + 1) % points.length] as Vec2;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best.distance) best = { segment: index, point: lerp(a, b, 0.5), distance: length };
  }
  return best;
}

function perimeterMm(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index] as Vec2;
    const b = points[(index + 1) % points.length] as Vec2;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// Descend along the loop from `start` at the ramp angle, round it as often as
// the drop needs, and report where the cutter reaches the level.
function rampAlong(
  points: ReadonlyArray<Vec2>,
  start: LoopPoint,
  fromZ: number,
  toZ: number,
  angleRad: number,
): { readonly points: ReadonlyArray<Vec3>; readonly end: LoopPoint } {
  const rampLength = (fromZ - toZ) / Math.tan(angleRad);
  const out: Vec3[] = [{ ...start.point, z: fromZ }];
  let travelled = 0;
  let at = start.point;
  for (let step = 1; ; step += 1) {
    const segment = (start.segment + step - 1) % points.length;
    const next = points[(segment + 1) % points.length] as Vec2;
    const length = Math.hypot(next.x - at.x, next.y - at.y);
    if (travelled + length >= rampLength) {
      const end = lerp(at, next, length === 0 ? 1 : (rampLength - travelled) / length);
      out.push({ ...end, z: toZ });
      return { points: out, end: { segment, point: end, distance: 0 } };
    }
    travelled += length;
    at = next;
    out.push({ ...next, z: fromZ - (travelled / rampLength) * (fromZ - toZ) });
  }
}

function chainPass(chain: Chain): CncPass {
  const floor = chain.airFloorZMm === undefined ? {} : { airFloorZMm: chain.airFloorZMm };
  if (chain.ramp.length === 0) {
    return {
      kind: 'contour',
      zMm: chain.zMm,
      polyline: dropCollinearPoints(chain.path),
      closed: false,
      ...(chain.entryPlunge ? { entryPlunge: true as const } : {}),
      ...floor,
    };
  }
  const atDepth = chain.path.slice(1).map((point) => ({ ...point, z: chain.zMm }));
  const pass: CncPath3dPass = {
    kind: 'path3d',
    points: dropCollinearPoints([...chain.ramp, ...atDepth]),
    closed: false,
    // The ramp's descent rides the cutting feed only as far as the plunge
    // rate allows; the level itself keeps the full cutting feed.
    lateralFeed: 'z-rate-capped',
    ...floor,
  };
  return pass;
}
