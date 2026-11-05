// Perf audit S1, S6-P3-1 and N3-P3-1: the nested selection's depths and its
// painting skip work, but must give exactly what painting every level against
// the whole region gave. The reference below is that painter, unchanged.

import type * as Clipper from 'clipper2-ts';
import { differenceD, FillRule, unionD, type PathD, type PathsD } from 'clipper2-ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import { nestedSelectionRegion } from './vector-path-nesting';
import { paintNestedUnits, type NestedUnit } from './vector-path-nesting-paint';

const clipperWork = vi.hoisted(() => ({ calls: 0, differences: 0, points: 0 }));

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Clipper>();
  const counted =
    <A extends unknown[], R>(run: (...args: A) => R, difference: boolean) =>
    (...args: A): R => {
      clipperWork.calls += 1;
      if (difference) clipperWork.differences += 1;
      for (const operand of args.slice(0, 2)) {
        if (Array.isArray(operand)) {
          for (const path of operand) clipperWork.points += Array.isArray(path) ? path.length : 0;
        }
      }
      return run(...args);
    };
  return {
    ...actual,
    unionD: counted(actual.unionD, false),
    differenceD: counted(actual.differenceD, true),
  };
});

beforeEach(() => {
  clipperWork.calls = 0;
  clipperWork.differences = 0;
  clipperWork.points = 0;
});

function referencePaint(units: ReadonlyArray<NestedUnit>): PathsD {
  const deepest = units.reduce((most, unit) => Math.max(most, unit.depth), 0);
  let region: PathsD = [];
  for (let depth = 0; depth <= deepest; depth += 1) {
    const level = units.filter((unit) => unit.depth === depth).flatMap((unit) => unit.paths);
    if (level.length === 0) continue;
    region =
      depth % 2 === 0
        ? unionD(region, level, FillRule.NonZero, 3)
        : differenceD(region, level, FillRule.NonZero, 3);
  }
  return canonicalizeVectorPaths(region);
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const grid = (value: number): number => Math.round(value * 1000) / 1000;

function polygon(cx: number, cy: number, radius: number, nodes: number, phase: number): PathD {
  return Array.from({ length: nodes }, (_, index) => {
    const angle = phase + (index / nodes) * Math.PI * 2;
    return { x: grid(cx + radius * Math.cos(angle)), y: grid(cy + radius * Math.sin(angle)) };
  });
}

function square(minX: number, minY: number, size: number): PathD {
  return [
    { x: minX, y: minY },
    { x: minX + size, y: minY },
    { x: minX + size, y: minY + size },
    { x: minX, y: minY + size },
  ];
}

const reversed = (path: PathD): PathD => [...path].reverse();

function concentric(
  cx: number,
  cy: number,
  count: number,
  gap: number,
  nodes: number,
): NestedUnit[] {
  return Array.from({ length: count }, (_, index) => ({
    depth: index,
    paths: [polygon(cx, cy, 2 + gap * (count - index), nodes, 0)],
  }));
}

// Targets that keep clear of each other, so levels are painted on their own:
// rings of a few sizes and node counts, islands side by side inside a ring,
// plates with holes, and depths that skip a level.
function apartScene(seed: number): NestedUnit[] {
  const next = random(seed);
  const units: NestedUnit[] = [];
  const targets = 1 + Math.floor(next() * 4);
  for (let target = 0; target < targets; target += 1) {
    const cx = 40 + 80 * (target % 2);
    const cy = 40 + 80 * Math.floor(target / 2);
    const count = 2 + Math.floor(next() * 8);
    const nodes = 24 + Math.floor(next() * 40);
    let depth = 0;
    for (let index = 0; index < count; index += 1) {
      const radius = 34 - index * (34 / (count + 1));
      const ring = polygon(cx, cy, radius, nodes, next() * 0.1);
      const holed = next() < 0.25;
      units.push({
        depth,
        paths: holed ? [ring, reversed(polygon(cx, cy, radius * 0.9, nodes, 0))] : [ring],
      });
      depth += next() < 0.15 ? 2 : 1;
    }
    if (next() < 0.5) {
      const radius = 34 / (count + 1) / 3;
      for (const side of [-1, 1]) {
        units.push({ depth, paths: [polygon(cx + side * radius * 1.5, cy, radius, 12, 0)] });
      }
    }
  }
  return units;
}

// Concentric families, scattered shapes that overlap and touch, plates with
// their holes, squares sharing edges, and gaps down to a grid step.
function scene(seed: number): NestedUnit[] {
  if (seed % 2 === 0) return apartScene(seed);
  const next = random(seed);
  const units: NestedUnit[] = [];
  const families = 1 + Math.floor(next() * 3);
  for (let family = 0; family < families; family += 1) {
    const count = 2 + Math.floor(next() * 7);
    const gap = next() < 0.3 ? 0.001 + Math.floor(next() * 4) / 1000 : 0.5 + next() * 3;
    const nodes = 3 + Math.floor(next() * 30);
    const cx = grid(next() * 60);
    const cy = grid(next() * 60);
    const phase = next() < 0.5 ? 0 : next();
    for (let index = 0; index < count; index += 1) {
      const ring = polygon(cx, cy, 2 + gap * (count - index), nodes, phase * index);
      units.push({ depth: index + (next() < 0.15 ? 1 : 0), paths: [ring] });
    }
  }
  const scattered = Math.floor(next() * 6);
  for (let index = 0; index < scattered; index += 1) {
    const cx = grid(next() * 60);
    const cy = grid(next() * 60);
    const radius = 1 + next() * 12;
    const outline = polygon(cx, cy, radius, 3 + Math.floor(next() * 20), next());
    const holed = next() < 0.4;
    units.push({
      depth: Math.floor(next() * 5),
      paths: holed ? [outline, reversed(polygon(cx, cy, radius / 2, 8, 0))] : [outline],
    });
  }
  if (next() < 0.4) {
    const size = 2 + Math.floor(next() * 5);
    for (let index = 0; index < 4; index += 1) {
      units.push({ depth: Math.floor(next() * 3), paths: [square(10 + size * index, 10, size)] });
    }
  }
  return units;
}

describe('painting a nested selection (perf audit N3-P3-1)', () => {
  it('gives exactly what painting each level against the whole region gives', () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const units = scene(seed);
      expect(JSON.stringify(paintNestedUnits(units)), `seed ${seed}`).toBe(
        JSON.stringify(referencePaint(units)),
      );
    }
  });

  it('matches on concentric rings a grid step apart and on rings that share vertices', () => {
    const tight = concentric(20, 20, 12, 0.001, 24);
    expect(paintNestedUnits(tight)).toEqual(referencePaint(tight));
    const touching: NestedUnit[] = [
      { depth: 0, paths: [square(0, 0, 10)] },
      { depth: 1, paths: [square(0, 0, 5)] },
      { depth: 2, paths: [square(1, 1, 2)] },
      { depth: 2, paths: [square(5, 5, 5)] },
    ];
    expect(paintNestedUnits(touching)).toEqual(referencePaint(touching));
  });

  it('feeds clipper each ring a bounded number of times, not once per level', () => {
    const units = concentric(100, 100, 120, 0.6, 64);
    const rings = units.length * 64;
    expect(paintNestedUnits(units)).toHaveLength(units.length);
    // Painting every level against the whole region fed clipper about
    // rings × levels / 2 points: 60 × rings here.
    expect(clipperWork.points).toBeLessThan(4 * rings);
  });
});

describe('ring depths of a nested selection (perf audit S6-P3-1)', () => {
  it('tests each concentric ring against the ring around it, not every larger ring', () => {
    const batches = Array.from({ length: 80 }, (_, index) => [
      polygon(100, 100, 5 + 1.5 * index, 48, 0),
    ]);
    const outer = nestedSelectionRegion(batches, true);
    expect(outer.kind).toBe('ok');
    if (outer.kind === 'ok') expect(outer.value).toHaveLength(1);
    // Two differences per containment test, one test per ring (and the final
    // union). Testing every larger ring took 80 × 79 differences.
    expect(clipperWork.differences).toBeLessThanOrEqual(2 * batches.length);
  });
});
