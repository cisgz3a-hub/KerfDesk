// Order and link waterline passes (ADR-423). Each feature is finished top
// down: after a contour, the next one is the nearest contour one level lower
// that a checked stay-down link can reach, so a wall is circled level after
// level without leaving the cut. When no such contour exists the chain ends
// (the emitter retracts) and the next chain starts at the highest remaining
// level, nearest to where the last one ended.
//
// A link goes across at the upper level, then straight down onto the next
// contour's vertex, whose exact tip is at most that level. Only the move across
// needs checking, like any waterline move. A straight diagonal would save a
// few hundredths of a millimetre of travel but could clip a corner between
// its checked points. Closed contours may start anywhere, so they start at the
// vertex nearest the link; open ones keep their direction.

import type { CncPath3dPass } from '../job';
import type { FinishingPoint } from './relief-finishing-path';
import type { WaterlineSurface } from './relief-waterline-contours';

export type WaterlineLevelPath = {
  // Level index: larger is deeper.
  readonly level: number;
  readonly closed: boolean;
  readonly points: ReadonlyArray<FinishingPoint>;
};

export type WaterlineOrderOptions = {
  readonly surface: WaterlineSurface;
  readonly maxLinkMm: number;
  readonly checkSpacingMm: number;
};

type Candidate = {
  readonly index: number;
  readonly start: number;
  readonly distance: number;
};

export function orderWaterlinePaths(
  paths: ReadonlyArray<WaterlineLevelPath>,
  options: WaterlineOrderOptions,
): ReadonlyArray<CncPath3dPass> {
  const used = new Uint8Array(paths.length);
  const passes: CncPath3dPass[] = [];
  let position: FinishingPoint | null = null;
  for (let remaining = paths.length; remaining > 0; ) {
    const first = nearestAtLevel(paths, used, highestLevel(paths, used), position);
    if (first === null) break;
    const chain = [...startAt(paths, first)];
    used[first.index] = 1;
    remaining -= 1;
    let level = paths[first.index]?.level ?? 0;
    for (;;) {
      const end = chain[chain.length - 1];
      if (end === undefined) break;
      const linked = nextLink(paths, used, level + 1, end, options);
      if (linked === null) break;
      chain.push(...linked.link, ...startAt(paths, linked.candidate));
      used[linked.candidate.index] = 1;
      remaining -= 1;
      level += 1;
    }
    position = chain[chain.length - 1] ?? position;
    passes.push({ kind: 'path3d', points: chain, closed: false, lateralFeed: 'z-rate-capped' });
  }
  return passes;
}

function highestLevel(paths: ReadonlyArray<WaterlineLevelPath>, used: Uint8Array): number {
  let level = Number.POSITIVE_INFINITY;
  paths.forEach((path, index) => {
    if (used[index] === 0) level = Math.min(level, path.level);
  });
  return level;
}

// The unused path at `level` nearest `from` (the first one when there is no
// position yet), with the vertex it should start at.
function nearestAtLevel(
  paths: ReadonlyArray<WaterlineLevelPath>,
  used: Uint8Array,
  level: number,
  from: FinishingPoint | null,
): Candidate | null {
  let best: Candidate | null = null;
  paths.forEach((path, index) => {
    if (used[index] === 1 || path.level !== level) return;
    const candidate = from === null ? { index, start: 0, distance: 0 } : entry(path, index, from);
    if (best === null || candidate.distance < best.distance) best = candidate;
  });
  return best;
}

function nextLink(
  paths: ReadonlyArray<WaterlineLevelPath>,
  used: Uint8Array,
  level: number,
  from: FinishingPoint,
  options: WaterlineOrderOptions,
): { readonly candidate: Candidate; readonly link: ReadonlyArray<FinishingPoint> } | null {
  const candidates: Candidate[] = [];
  paths.forEach((path, index) => {
    if (used[index] === 1 || path.level !== level) return;
    const candidate = entry(path, index, from);
    if (candidate.distance <= options.maxLinkMm) candidates.push(candidate);
  });
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    const to = paths[candidate.index]?.points[candidate.start];
    if (to === undefined) continue;
    const link = checkedLink(from, to, options);
    if (link !== null) return { candidate, link };
  }
  return null;
}

// Where a path is entered from `from`: any vertex of a closed path, the first
// of an open one. Distance is measured in XY.
function entry(path: WaterlineLevelPath, index: number, from: FinishingPoint): Candidate {
  const count = path.closed ? path.points.length - 1 : 1;
  let start = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let k = 0; k < count; k += 1) {
    const point = path.points[k];
    if (point === undefined) continue;
    const d = Math.hypot(point.x - from.x, point.y - from.y);
    if (d < distance) {
      distance = d;
      start = k;
    }
  }
  return { index, start, distance };
}

// The path's vertices from its start: a closed path (last vertex repeating the
// first) is rotated to begin and end at `start`.
function startAt(
  paths: ReadonlyArray<WaterlineLevelPath>,
  candidate: Candidate,
): ReadonlyArray<FinishingPoint> {
  const path = paths[candidate.index];
  if (path === undefined) return [];
  if (!path.closed || candidate.start === 0) return path.points;
  const loop = path.points.slice(0, -1);
  const rotated = [...loop.slice(candidate.start), ...loop.slice(0, candidate.start)];
  const first = rotated[0];
  return first === undefined ? rotated : [...rotated, first];
}

// The corner of a checked link from `from` to `to`, or null when the move
// across does not clear the model.
function checkedLink(
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlineOrderOptions,
): ReadonlyArray<FinishingPoint> | null {
  // Straight down from the corner cannot cut: the tip below `to` is at most
  // its z. Only the level move across is checked.
  const corner = { x: to.x, y: to.y, z: Math.max(from.z, to.z) };
  return moveClears(from, corner, options) ? [corner] : null;
}

function moveClears(
  from: FinishingPoint,
  to: FinishingPoint,
  options: WaterlineOrderOptions,
): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(2, Math.ceil(length / options.checkSpacingMm));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + t * (to.x - from.x);
    const y = from.y + t * (to.y - from.y);
    if (!options.surface.clears(x, y, from.z + t * (to.z - from.z))) return false;
  }
  return true;
}
