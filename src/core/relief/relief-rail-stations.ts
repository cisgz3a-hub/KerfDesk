// The stations a rail sweep is sectioned at (ADR-575): where along the rail,
// and where each station's section reaches either side of it.

import type {
  ReliefProfileSection,
  ReliefRailProfileSource,
} from '../scene/relief/relief-rail-profile';
import type { Vec2 } from '../scene/scene-object';

export type Vertex = Vec2 & { readonly u: number; readonly t: number };
export type Rail = {
  readonly points: ReadonlyArray<Vec2>;
  readonly distances: ReadonlyArray<number>;
  readonly length: number;
};
export type Sides = ReadonlyArray<{ readonly left: Vertex; readonly right: Vertex }>;

export function measuredRail(points: ReadonlyArray<Vec2>): Rail {
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1],
      b = points[i];
    if (a !== undefined && b !== undefined)
      distances.push((distances[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = distances[distances.length - 1] ?? 0;
  if (!(length > 0)) throw new Error('Rail requires a non-zero physical length.');
  return { points, distances, length };
}
export function pointOnRail(rail: Rail, t: number): Vec2 {
  const distance = t * rail.length;
  for (let i = 1; i < rail.points.length; i += 1) {
    const end = rail.distances[i] ?? 0;
    if (end < distance && i < rail.points.length - 1) continue;
    const a = rail.points[i - 1],
      b = rail.points[i];
    if (a === undefined || b === undefined) continue;
    const start = rail.distances[i - 1] ?? 0,
      fraction = Math.max(0, Math.min(1, (distance - start) / (end - start)));
    return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
  }
  throw new Error('Rail has no usable segment.');
}
export function parameters(
  source: ReliefRailProfileSource,
  first: Rail,
  second: Rail | undefined,
): number[] {
  const values = [
    ...Array.from({ length: source.samplingSteps + 1 }, (_, i) => i / source.samplingSteps),
    ...first.distances.map((d) => d / first.length),
    ...(second?.distances.map((d) => d / second.length) ?? []),
    ...source.sections.map((s) => s.position),
  ];
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length > 256) throw new Error('Rail strip exceeds its 256-position geometry budget.');
  return sorted;
}
export function stripSides(
  source: ReliefRailProfileSource,
  first: Rail,
  second: Rail | undefined,
  t: number,
): { readonly left: Vertex; readonly right: Vertex } {
  const center = pointOnRail(first, t),
    scale = sectionWidth(source.sections, t);
  let left: Vec2, right: Vec2;
  if (second === undefined) {
    const before = pointOnRail(first, Math.max(0, t - 1e-5)),
      after = pointOnRail(first, Math.min(1, t + 1e-5));
    const dx = after.x - before.x,
      dy = after.y - before.y,
      length = Math.hypot(dx, dy);
    if (!(length > 1e-12)) throw new Error('Rail reverses or collapses at a strip position.');
    const nx = ((-dy / length) * source.widthMm * scale) / 2,
      ny = ((dx / length) * source.widthMm * scale) / 2;
    left = { x: center.x - nx, y: center.y - ny };
    right = { x: center.x + nx, y: center.y + ny };
  } else {
    const edge = pointOnRail(second, t),
      cx = (center.x + edge.x) / 2,
      cy = (center.y + edge.y) / 2;
    left = { x: cx + (center.x - cx) * scale, y: cy + (center.y - cy) * scale };
    right = { x: cx + (edge.x - cx) * scale, y: cy + (edge.y - cy) * scale };
  }
  return { left: { ...left, u: 0, t }, right: { ...right, u: 1, t } };
}

// Stations closer than this along the rail are one station: a vertex a rounding
// error from a sampling step would otherwise leave a strip with no length.
const SAME_STATION_MM = 1e-6;

export function snappedParameters(
  values: ReadonlyArray<number>,
  first: Rail,
  second: Rail | undefined,
): number[] {
  const tolerance = SAME_STATION_MM / Math.max(first.length, second?.length ?? 0);
  const kept: number[] = [];
  for (const value of values) {
    const last = kept[kept.length - 1];
    if (last === undefined || value - last > tolerance) kept.push(value);
    else if (value === 1) kept[kept.length - 1] = 1;
  }
  return kept;
}

// Each vertex's normal halves the turn between its two segments, and the
// normal turns evenly along each segment between its ends' normals: the rail
// read as the smooth curve its points sample.
export function vertexNormals(rail: Rail): ReadonlyArray<Vec2> {
  const segments: Vec2[] = [];
  for (let i = 1; i < rail.points.length; i += 1) {
    const a = rail.points[i - 1],
      b = rail.points[i];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({ x: -(b.y - a.y) / length, y: (b.x - a.x) / length });
  }
  return rail.points.map((_, i) => {
    const before = segments[i - 1] ?? segments[i],
      after = segments[i] ?? segments[i - 1];
    if (before === undefined || after === undefined) throw new Error('Rail has no usable segment.');
    const x = before.x + after.x,
      y = before.y + after.y,
      length = Math.hypot(x, y);
    if (!(length > 1e-9)) throw new Error('Rail turns straight back on itself at a vertex.');
    return { x: x / length, y: y / length };
  });
}

export function smoothStripSides(
  source: ReliefRailProfileSource,
  rail: Rail,
  normals: ReadonlyArray<Vec2>,
  t: number,
): { readonly left: Vertex; readonly right: Vertex } {
  const center = pointOnRail(rail, t),
    scale = sectionWidth(source.sections, t),
    distance = t * rail.length;
  let i = 1;
  while (i < rail.points.length - 1 && (rail.distances[i] ?? 0) < distance) i += 1;
  const start = rail.distances[i - 1] ?? 0,
    end = rail.distances[i] ?? 0,
    fraction = Math.max(0, Math.min(1, (distance - start) / (end - start)));
  const a = normals[i - 1],
    b = normals[i];
  if (a === undefined || b === undefined) throw new Error('Rail has no usable segment.');
  const x = a.x + (b.x - a.x) * fraction,
    y = a.y + (b.y - a.y) * fraction,
    length = Math.hypot(x, y);
  if (!(length > 1e-9)) throw new Error('Rail sweep folds; its normal reverses along a segment.');
  const nx = (x / length) * ((source.widthMm * scale) / 2),
    ny = (y / length) * ((source.widthMm * scale) / 2);
  return {
    left: { x: center.x - nx, y: center.y - ny, u: 0, t },
    right: { x: center.x + nx, y: center.y + ny, u: 1, t },
  };
}

export function surroundingSections(
  sections: ReadonlyArray<ReliefProfileSection>,
  t: number,
): { a: ReliefProfileSection; b: ReliefProfileSection; fraction: number } {
  const first = sections[0];
  if (first === undefined) throw new Error('A rail requires profiles.');
  for (let i = 1; i < sections.length; i += 1) {
    const a = sections[i - 1],
      b = sections[i];
    if (a !== undefined && b !== undefined && t <= b.position)
      return {
        a,
        b,
        fraction: Math.max(0, Math.min(1, (t - a.position) / (b.position - a.position))),
      };
  }
  const last = sections[sections.length - 1] ?? first;
  return { a: last, b: last, fraction: 0 };
}
export function sectionWidth(sections: ReadonlyArray<ReliefProfileSection>, t: number): number {
  const { a, b, fraction } = surroundingSections(sections, t);
  return a.widthScale * (1 - fraction) + b.widthScale * fraction;
}
