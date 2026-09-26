import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  createLayer,
  type ColoredPath,
  type Polyline,
  type TracedImage,
  type Vec2,
} from '../scene';
import { withSubpathNesting } from '../scene/subpath-nesting';
import { compileJob } from './compile-job';
import type { CutGroup } from './job';
import { optimizePaths } from './optimize-paths';

// ADR-441: inside-first cutting reads a traced path's carried forest. A
// hollow C (a C-shaped band whose C-shaped hole ends inside it) is the case
// the bounds-centre probe gets wrong: the hole's bounds centre lies in the
// C's mouth, outside the outline, so the hole was ordered as an outer.

const color = '#000000';
const layer = { ...createLayer({ id: 'cut', color }), mode: 'line' as const };

// Outline of the band {inner <= r <= outer, |angle| >= mouth} around (cx, cy).
function band(cx: number, cy: number, inner: number, outer: number, mouth: number): Polyline {
  const points: Vec2[] = [];
  const at = (r: number, deg: number): Vec2 => ({
    x: cx + r * Math.cos((deg * Math.PI) / 180),
    y: cy + r * Math.sin((deg * Math.PI) / 180),
  });
  for (let deg = mouth; deg <= 360 - mouth; deg += 5) points.push(at(outer, deg));
  for (let deg = 360 - mouth; deg >= mouth; deg -= 5) points.push(at(inner, deg));
  return { closed: true, points };
}

// Machine coordinates equal scene coordinates with a rear-left origin; the
// outline starts at its vertex nearest that origin, the hole far from it.
const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };
const nearestOriginFirst = (ring: Polyline): Polyline => {
  const distances = ring.points.map((p) => Math.hypot(p.x, p.y));
  const start = distances.indexOf(Math.min(...distances));
  return { ...ring, points: [...ring.points.slice(start), ...ring.points.slice(0, start)] };
};
const outline = nearestOriginFirst(band(60, 60, 13, 27, 35));
const hole = band(60, 60, 17, 23, 48);

function trace(path: ColoredPath): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'c.png',
    bounds: { minX: 0, minY: 0, maxX: 120, maxY: 120 },
    transform: IDENTITY_TRANSFORM,
    paths: [path],
  };
}

function firstCut(path: ColoredPath): number {
  const compiled = compileJob({ objects: [trace(path)], layers: [layer] }, device);
  const job = optimizePaths(compiled, { ...DEFAULT_PROJECT_OPTIMIZATION, insideFirst: true });
  const group = job.groups[0] as CutGroup;
  expect(group.segments).toHaveLength(2);
  // Identify the first cut by its vertex count (a closed segment repeats its start).
  return (group.segments[0]?.polyline.length ?? 0) - 1;
}

describe('inside-first ordering of a traced path (ADR-441)', () => {
  it('cuts the hole of a hollow C before its outline only with the carried forest', () => {
    const plain: ColoredPath = { color, polylines: [outline, hole] };
    expect(outline.points.length).not.toBe(hole.points.length);
    // Without the forest the probe misses the hole: both read as outers and
    // nearest-neighbour order from the origin reaches the outline first.
    expect(firstCut(plain)).toBe(outline.points.length);
    const nested = withSubpathNesting(plain, [-1, 0]);
    expect(nested.subpathNesting).toBeDefined();
    expect(firstCut(nested)).toBe(hole.points.length);
  });

  it('keeps the forest on a layer with tabs, whole contours and split pieces alike', () => {
    const nested = withSubpathNesting({ color, polylines: [outline, hole] }, [-1, 0]);
    const tabbed = { ...layer, tabsEnabled: true, tabSizeMm: 2, tabsPerShape: 4 };
    const compiled = compileJob({ objects: [trace(nested)], layers: [tabbed] }, device);
    const segments = (compiled.groups[0] as CutGroup).segments;
    // The outline takes four tabs; the hole, an inner shape, is skipped.
    const pieces = segments.filter((segment) => !segment.closed);
    const whole = segments.filter((segment) => segment.closed);
    expect(pieces).toHaveLength(4);
    expect(whole).toHaveLength(1);
    expect(pieces.every((piece) => piece.nesting?.depth === 0)).toBe(true);
    expect(whole[0]?.nesting?.depth).toBe(1);
    expect(new Set(segments.map((segment) => segment.nesting?.forest)).size).toBe(1);
    const job = optimizePaths(compiled, { ...DEFAULT_PROJECT_OPTIMIZATION, insideFirst: true });
    expect((job.groups[0] as CutGroup).segments[0]?.closed).toBe(true);
  });

  it('ignores a forest whose geometry changed since it was written', () => {
    const nested = withSubpathNesting({ color, polylines: [outline, hole] }, [-1, 0]);
    const moved: ColoredPath = {
      ...nested,
      polylines: [outline, { ...hole, points: hole.points.map((p) => ({ x: p.x + 80, y: p.y })) }],
    };
    const compiled = compileJob({ objects: [trace(moved)], layers: [layer] }, device);
    const segments = (compiled.groups[0] as CutGroup).segments;
    expect(segments.every((segment) => segment.nesting === undefined)).toBe(true);
  });
});
