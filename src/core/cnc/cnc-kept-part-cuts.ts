// Profile cuts that reach a part another operation keeps (ADR-433 Amendment 3;
// meta audit v1 M6-P2-3).
//
// The narrow-gap check (ADR-433) reads one operation at a time, so parts on two
// profile operations placed closer than the bit drew no warning, although each
// cut ran into the other part. Here every compiled profile toolpath is held
// against the kept walls of every OTHER profile operation: the walls ADR-250
// Amendment 3 keeps leads clear of, by the same cutter-disk test. The cut
// reaches a kept part where its centreline comes closer to the wall than the
// cutter radius (less what that wall's own cut removes), from the waste side,
// or where it crosses the wall. As for leads, a wall whose kept side holds the
// whole toolpath is skipped: it is the outer boundary of a larger part the cut
// lies inside, behind a nearer wall that is checked instead. Unlike a lead, a
// toolpath can start inside the other part (parts closer than the cutter
// radius), so only a path that never meets the wall is skipped.
//
// Evidence only: every contour is still cut where it is drawn, and Job Review
// says which operations meet (rule 7, ADR-565).

import { pointInPolygon } from '../geometry';
import type { CncKeptPartCut } from '../job/cnc-compilation-sidecar-types';
import { cncPassXyPoints, type CncGroup } from '../job/job';
import { closestSegmentPoints } from '../min-feature/segment-distance';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Layer,
  type Vec2,
} from '../scene';
import { isProfileCutType } from './compile-cnc-helpers';
import { profileFinishAllowanceMm } from './finish-allowance';
import {
  KEPT_WALL_TOLERANCE_MM,
  profileLeadCutWidthMm,
  type ProfileLeadKeptWall,
} from './profile-lead-kept-walls';

/** One compiled profile operation: its passes and the radius its cutter sweeps. */
export type KeptPartCutOperation = {
  readonly layer: Layer;
  readonly groups: ReadonlyArray<CncGroup>;
  readonly cutterRadiusMm: number;
  /** The allowance its roughing ring stands off the finished wall (ADR-140). */
  readonly finishAllowanceMm: number;
};

/** A toolpath this close to a wall touches or crosses it. */
const CROSSING_MM = 1e-9;

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type Toolpath = { readonly points: ReadonlyArray<Vec2>; readonly box: Box };

type Reach = { readonly depthMm: number | null; readonly at: Vec2 };

type Tally = {
  readonly walls: Set<ProfileLeadKeptWall>;
  deepest: Reach;
};

/** The operation to measure, or null when it cuts no profile walls of its own
 * (the same operations `profileLeadJobWalls` collects walls for). */
export function keptPartCutOperation(
  layer: Layer,
  groups: ReadonlyArray<CncGroup>,
  config: CncMachineConfig,
): KeptPartCutOperation | null {
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  if (!isProfileCutType(settings.cutType) || settings.reliefProjection !== undefined) return null;
  const cutWidthMm = profileLeadCutWidthMm(layerCncTool(config, settings), settings);
  return {
    layer,
    groups,
    cutterRadiusMm: cutWidthMm / 2,
    finishAllowanceMm: profileFinishAllowanceMm(settings, cutWidthMm),
  };
}

/** Where each operation's cut reaches a part another operation keeps. */
export function cncKeptPartCuts(
  operations: ReadonlyArray<KeptPartCutOperation>,
  walls: ReadonlyArray<ProfileLeadKeptWall>,
): ReadonlyArray<CncKeptPartCut> {
  const names = new Map(operations.map(({ layer }) => [layer.id, layer.name]));
  const found: CncKeptPartCut[] = [];
  for (const operation of operations) {
    const others = walls.filter(
      (wall) => wall.layerId !== undefined && wall.layerId !== operation.layer.id,
    );
    if (others.length === 0) continue;
    const tallies = new Map<string, Tally>();
    for (const toolpath of distinctToolpaths(operation.groups)) {
      for (const wall of others) {
        const reach = wallReach(toolpath, operation.cutterRadiusMm, wall);
        if (reach === null) continue;
        const keptLayerId = wall.layerId as string;
        const tally = tallies.get(keptLayerId);
        if (tally === undefined)
          tallies.set(keptLayerId, { walls: new Set([wall]), deepest: reach });
        else {
          tally.walls.add(wall);
          if (deeper(reach, tally.deepest)) tally.deepest = reach;
        }
      }
    }
    for (const [keptLayerId, tally] of tallies) {
      const allowanceMm = operation.finishAllowanceMm;
      found.push({
        layerId: operation.layer.id,
        layerName: operation.layer.name,
        keptLayerId,
        keptLayerName: names.get(keptLayerId) ?? keptLayerId,
        contours: tally.walls.size,
        depthMm: tally.deepest.depthMm,
        at: tally.deepest.at,
        cutWidthMm: 2 * operation.cutterRadiusMm,
        ...(onlyRoughingReaches(tally.deepest.depthMm, allowanceMm)
          ? { finishAllowanceMm: allowanceMm }
          : {}),
      });
    }
  }
  return found;
}

// The roughing ring runs the allowance further out than the finishing pass, so
// a reach no deeper than the allowance (within the gouge tolerance) is the
// roughing ring's alone: without the allowance nothing would be reported.
function onlyRoughingReaches(depthMm: number | null, allowanceMm: number): boolean {
  return allowanceMm > 0 && depthMm !== null && depthMm <= allowanceMm + KEPT_WALL_TOLERANCE_MM;
}

/** A cut onto the kept side (null depth) is deepest; otherwise the larger reach. */
function deeper(candidate: Reach, current: Reach): boolean {
  if (current.depthMm === null) return false;
  return candidate.depthMm === null || candidate.depthMm > current.depthMm;
}

// Depth passes repeat one XY path, so each path is measured once.
function distinctToolpaths(groups: ReadonlyArray<CncGroup>): Toolpath[] {
  const seen = new Set<string>();
  const out: Toolpath[] = [];
  for (const group of groups) {
    for (const pass of group.passes) {
      const xy = cncPassXyPoints(pass);
      const first = xy[0];
      const last = xy.at(-1);
      if (first === undefined || last === undefined || xy.length < 2) continue;
      const key = `${xy.length}:${first.x}:${first.y}:${last.x}:${last.y}:${pass.closed}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const points = pass.closed ? [...xy, first] : xy;
      out.push({ points, box: pointsBox(points) });
    }
  }
  return out;
}

function wallReach(
  toolpath: Toolpath,
  cutterRadiusMm: number,
  wall: ProfileLeadKeptWall,
): Reach | null {
  const reach = cutterRadiusMm - wall.clearedMm - KEPT_WALL_TOLERANCE_MM;
  if (reach <= 0 || !boxesNear(toolpath.box, wall, reach)) return null;
  const closest = closestApproach(toolpath, wall, reach);
  if (closest === null || closest.distance >= reach) return null;
  // A path that meets the wall runs from one side onto the other: it cuts the part.
  if (closest.distance <= CROSSING_MM) return { depthMm: null, at: closest.at };
  // A path wholly on the kept side lies inside a larger part, behind a nearer wall.
  const start = toolpath.points[0] as Vec2;
  if (pointInPolygon(start, wall.ring) === wall.keptInside) return null;
  return { depthMm: cutterRadiusMm - wall.clearedMm - closest.distance, at: closest.at };
}

/** The toolpath's nearest approach to the wall, among pieces within `reach` of it. */
function closestApproach(
  toolpath: Toolpath,
  wall: ProfileLeadKeptWall,
  reach: number,
): { readonly distance: number; readonly at: Vec2 } | null {
  const ring = wall.ring;
  const path = toolpath.points;
  let best: { distance: number; at: Vec2 } | null = null;
  for (let i = 0; i < ring.length; i += 1) {
    const c = ring[i] as Vec2;
    const d = ring[(i + 1) % ring.length] as Vec2;
    const edge = segmentBox(c, d);
    if (!boxesNear(toolpath.box, edge, reach)) continue;
    for (let j = 1; j < path.length; j += 1) {
      const a = path[j - 1] as Vec2;
      const b = path[j] as Vec2;
      if (!boxesNear(segmentBox(a, b), edge, reach)) continue;
      const pair = closestSegmentPoints(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y);
      const distance = Math.sqrt(pair.distSq);
      if (best !== null && distance >= best.distance) continue;
      // The deepest place is reported at the wall: where the kept part is cut.
      best = { distance, at: { x: c.x + (d.x - c.x) * pair.t, y: c.y + (d.y - c.y) * pair.t } };
    }
  }
  return best;
}

function boxesNear(a: Box, b: Box, margin: number): boolean {
  return (
    a.minX - margin <= b.maxX &&
    a.maxX + margin >= b.minX &&
    a.minY - margin <= b.maxY &&
    a.maxY + margin >= b.minY
  );
}

function segmentBox(a: Vec2, b: Vec2): Box {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

// A loop, not Math.min(...points): a toolpath can hold more vertices than a
// call's argument list allows.
function pointsBox(points: ReadonlyArray<Vec2>): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
