import { expect } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../core/devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type LayerFillStyle,
  type LayerOperationSettings,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../core/scene';
import { compileJob } from '../core/job/compile-job';
import type { FillGroup, Job } from '../core/job/job';
export const color = '#000000';
export const operationId = 'fill';
export const styles = ['scanline', 'island', 'offset'] as const;
export const device = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  bedWidth: 500,
  bedHeight: 250,
};
export const margin = 0.4;
export type Rectangle = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
export type Burn = {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly midpoint: Vec2;
  readonly group: FillGroup;
};
export const rectangle = (x: number, y: number, width: number, height = width): Rectangle => ({
  minX: x,
  minY: y,
  maxX: x + width,
  maxY: y + height,
});
export const plate = rectangle(10, 10, 80);
export const hole = rectangle(34, 34, 32);
export const island = rectangle(42, 42, 16);
export const nested = [plate, hole, island];
export const crossing = [
  rectangle(10, 10, 50, 40),
  rectangle(30, 20, 40, 40),
  rectangle(20, 30, 50, 45),
];

export function contour(r: Rectangle): Polyline {
  return {
    closed: true,
    points: [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ],
  };
}
export function artwork(
  id: string,
  bounds: Rectangle,
  extra: Partial<ImportedSvg> = {},
): ImportedSvg {
  return {
    id,
    kind: 'imported-svg',
    source: `${id}.svg`,
    bounds,
    transform: IDENTITY_TRANSFORM,
    operationIds: [operationId],
    paths: [{ color, polylines: [contour(bounds)] }],
    ...extra,
  };
}
export function fillLayer(
  fillStyle: LayerFillStyle,
  settings: Partial<LayerOperationSettings> = {},
): Layer {
  return {
    ...createLayer({ id: operationId, color, mode: 'fill' }),
    power: 80,
    speed: 1200,
    passes: 1,
    airAssist: false,
    hatchAngleDeg: 0,
    hatchSpacingMm: 1,
    fillCrossHatch: false,
    fillBidirectional: false,
    fillOverscanMm: 0,
    fillStyle,
    ...settings,
  };
}
export const compile = (objects: readonly SceneObject[], layer: Layer): Job =>
  compileJob({ objects, layers: [layer] }, device);
export const fillGroups = (job: Job): FillGroup[] =>
  job.groups.filter((group): group is FillGroup => group.kind === 'fill');

// The oracle uses only input rectangles and emitted burn-edge interiors. It
// calls no fill, containment, clipping, nesting or process-bucketing helper.
export function contains(r: Rectangle, p: Vec2): boolean {
  return p.x > r.minX && p.x < r.maxX && p.y > r.minY && p.y < r.maxY;
}
export function boundaryDistance(r: Rectangle, p: Vec2): number {
  const x = Math.max(r.minX, Math.min(r.maxX, p.x));
  const y = Math.max(r.minY, Math.min(r.maxY, p.y));
  return Math.min(
    Math.hypot(p.x - x, p.y - r.minY),
    Math.hypot(p.x - x, p.y - r.maxY),
    Math.hypot(p.x - r.minX, p.y - y),
    Math.hypot(p.x - r.maxX, p.y - y),
  );
}
export function wellInside(p: Vec2, rectangles: readonly Rectangle[]): boolean {
  return rectangles.every((r) => boundaryDistance(r, p) > margin);
}
type BoundaryAxes = { readonly x: readonly number[]; readonly y: readonly number[] };

function boundaryTimes(a: Vec2, b: Vec2, axes: BoundaryAxes): number[] {
  const times = new Set([0, 1]);
  for (const [start, end, boundaries] of [
    [a.x, b.x, axes.x],
    [a.y, b.y, axes.y],
  ] as const) {
    if (start === end) continue;
    for (const boundary of boundaries) {
      const time = (boundary - start) / (end - start);
      if (time > 0 && time < 1) times.add(time);
    }
  }
  return [...times].sort((a, b) => a - b);
}

function appendEdgeIntervals(
  out: Burn[],
  a: Vec2,
  b: Vec2,
  group: FillGroup,
  axes: BoundaryAxes,
): void {
  if (Math.hypot(b.x - a.x, b.y - a.y) === 0) return;
  const times = boundaryTimes(a, b, axes);
  const at = (time: number): Vec2 => ({
    x: a.x + (b.x - a.x) * time,
    y: a.y + (b.y - a.y) * time,
  });
  for (let i = 1; i < times.length; i += 1) {
    const low = times[i - 1],
      high = times[i];
    if (low === undefined || high === undefined || !(high > low)) continue;
    const from = at(low),
      to = at(high);
    if (Math.hypot(to.x - from.x, to.y - from.y) === 0) continue;
    out.push({ a: from, b: to, midpoint: at((low + high) / 2), group });
  }
}

// Every fixture rectangle edge lies on one of these axis lines. Splitting at
// all such lines (even outside that rectangle's edge extent) is a harmless
// over-partition: membership is constant in each positive-length interval.
// The axes are built once, avoiding an edge-by-rectangle quadratic scan.
export function burns(job: Job, rectangles: readonly Rectangle[] = []): Burn[] {
  const out: Burn[] = [];
  const axes = {
    x: [...new Set(rectangles.flatMap((r) => [r.minX, r.maxX]))],
    y: [...new Set(rectangles.flatMap((r) => [r.minY, r.maxY]))],
  };
  for (const group of fillGroups(job)) {
    for (const segment of group.segments) {
      for (let i = 1; i < segment.polyline.length; i += 1) {
        const a = segment.polyline[i - 1],
          b = segment.polyline[i];
        if (a !== undefined && b !== undefined) appendEdgeIntervals(out, a, b, group, axes);
      }
      const first = segment.polyline[0],
        last = segment.polyline.at(-1);
      if (segment.closed && first !== undefined && last !== undefined)
        appendEdgeIntervals(out, last, first, group, axes);
    }
  }
  return out;
}

// Boundary motion is not an open interior. Exclude only float-scale boundary
// ambiguity, rather than the coverage fixture's 0.4 mm sampling margin.
export function interiorBurns(job: Job, rectangles: readonly Rectangle[]): Burn[] {
  return burns(job, rectangles).filter((burn) =>
    rectangles.every((r) => boundaryDistance(r, burn.midpoint) > 1e-7),
  );
}
export function nestedOwner(p: Vec2): 'outer' | 'island' | 'void' {
  if (contains(island, p)) return 'island';
  if (contains(hole, p)) return 'void';
  return contains(plate, p) ? 'outer' : 'void';
}
export const crossingOwners = (p: Vec2, rectangles = crossing): number[] =>
  rectangles.flatMap((r, i) => (contains(r, p) ? [i] : []));
const describeBurn = (burn: Burn) => ({
  at: burn.midpoint,
  power: burn.group.power,
  speed: burn.group.speed,
});
export function voidBurns(
  job: Job,
  rectangles: readonly Rectangle[],
  isMaterial: (p: Vec2) => boolean,
) {
  return interiorBurns(job, rectangles)
    .filter((burn) => !isMaterial(burn.midpoint))
    .map(describeBurn);
}
export function nestedMaterial(
  job: Job,
  expectedIslandPower = 20,
  islandSpeed = 1200,
  islandAir = false,
): void {
  const interior = interiorBurns(job, nested);
  const outerBurns = interior.filter((burn) => nestedOwner(burn.midpoint) === 'outer');
  const islandBurns = interior.filter((burn) => nestedOwner(burn.midpoint) === 'island');
  expect(outerBurns.length).toBeGreaterThan(0);
  expect(islandBurns.length).toBeGreaterThan(0);
  expect(outerBurns.map(({ group }) => [group.power, group.speed, group.airAssist])).toEqual(
    outerBurns.map(() => [80, 1200, false]),
  );
  expect(islandBurns.map(({ group }) => [group.power, group.speed, group.airAssist])).toEqual(
    islandBurns.map(() => [expectedIslandPower, islandSpeed, islandAir]),
  );
}

// Positive-length shared collinear burn intervals detect duplicate material
// burns without requiring a sample point to lie on any particular hatch.
function sharedInterior(a: Burn, b: Burn): Vec2 | null {
  const dx = a.b.x - a.a.x,
    dy = a.b.y - a.a.y,
    length = Math.hypot(dx, dy);
  const ux = dx / length,
    uy = dy / length;
  const cross = (p: Vec2) => (p.x - a.a.x) * uy - (p.y - a.a.y) * ux;
  if (Math.abs(cross(b.a)) > 1e-7 || Math.abs(cross(b.b)) > 1e-7) return null;
  const project = (p: Vec2) => (p.x - a.a.x) * ux + (p.y - a.a.y) * uy;
  const low = Math.max(0, Math.min(project(b.a), project(b.b)));
  const high = Math.min(length, Math.max(project(b.a), project(b.b)));
  if (!(high > low)) return null;
  const along = (low + high) / 2;
  return { x: a.a.x + ux * along, y: a.a.y + uy * along };
}
export function duplicateMaterialBurns(
  job: Job,
  rectangles: readonly Rectangle[],
  isMaterial: (p: Vec2) => boolean,
) {
  const edges = interiorBurns(job, rectangles),
    duplicates: Array<{ readonly at: Vec2; readonly powers: readonly number[] }> = [];
  for (let i = 0; i < edges.length; i += 1) {
    const a = edges[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < edges.length; j += 1) {
      const b = edges[j];
      if (b === undefined) continue;
      const at = sharedInterior(a, b);
      if (at !== null && isMaterial(at))
        duplicates.push({ at, powers: [a.group.power, b.group.power] });
    }
  }
  return duplicates;
}
export function angle(burn: Burn): number {
  const degrees = (Math.atan2(burn.b.y - burn.a.y, burn.b.x - burn.a.x) * 180) / Math.PI;
  return Math.round((((degrees % 180) + 180) % 180) * 1e6) / 1e6;
}
export function nestedObjects(process = false): ImportedSvg[] {
  return [
    artwork('plate', plate),
    artwork('hole', hole, {
      powerScale: 50,
      ...(process
        ? {
            operationOverride: {
              byOperation: {
                [operationId]: { hatchAngleDeg: 33, hatchSpacingMm: 1.3, speed: 900 },
              },
            },
          }
        : {}),
    }),
    artwork('island', island, {
      powerScale: 25,
      ...(process
        ? {
            operationOverride: {
              byOperation: {
                [operationId]: {
                  hatchAngleDeg: 90,
                  hatchSpacingMm: 0.75,
                  speed: 600,
                  airAssist: true,
                },
              },
            },
          }
        : {}),
    }),
  ];
}
export const crossingObjects = (differentPower: boolean): ImportedSvg[] =>
  crossing.map((r, i) =>
    artwork(`cross-${i}`, r, differentPower ? { powerScale: [100, 50, 25][i] ?? 100 } : {}),
  );
