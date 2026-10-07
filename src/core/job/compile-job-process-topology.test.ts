import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type LayerOperationSettings,
  type Polyline,
  type SceneObject,
} from '../scene';
import { compileJob } from './compile-job';
import type { CutSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  bedWidth: 200,
  bedHeight: 200,
};
const color = '#000000';
const square = (at: number, size: number): Polyline => ({
  closed: true,
  points: [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
  ],
});
function artwork(id: string, at: number, size: number): ImportedSvg {
  return {
    id,
    kind: 'imported-svg',
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    paths: [{ color, polylines: [square(at, size)] }],
  };
}
const plate = artwork('plate', 0, 100);
const hole = artwork('hole', 40, 20);
const island = artwork('island', 45, 10);
const layer = (settings: Partial<LayerOperationSettings> = {}): Layer => ({
  ...createLayer({ id: 'operation', color, mode: 'line' }),
  power: 80,
  speed: 1200,
  passes: 2,
  ...settings,
});
const compile = (objects: readonly SceneObject[], operation = layer()): Job =>
  compileJob({ objects, layers: [operation] }, device);
function cutSegments(job: Job): CutSegment[] {
  return job.groups.flatMap((group) => (group.kind === 'cut' ? [...group.segments] : []));
}
function width(segment: CutSegment): number {
  return (
    Math.round(
      (Math.max(...segment.polyline.map((p) => p.x)) -
        Math.min(...segment.polyline.map((p) => p.x))) *
        1000,
    ) / 1000
  );
}
const widths = (job: Job) => cutSegments(job).map(width);
const sortedWidths = (job: Job) => widths(job).sort((a, b) => b - a);
function fillOwnersAt(job: Job, x: number, y: number): number[] {
  return job.groups.flatMap((group) => {
    if (group.kind !== 'fill') return [];
    const burns = group.segments.some(
      ({ polyline }) =>
        polyline.length >= 2 &&
        polyline.every((p) => Math.abs(p.y - y) < 1e-8) &&
        Math.min(...polyline.map((p) => p.x)) < x &&
        Math.max(...polyline.map((p) => p.x)) > x,
    );
    return burns ? [group.power] : [];
  });
}
function interiorScanY(job: Job): number {
  const point = job.groups
    .flatMap((group) =>
      group.kind === 'fill' ? group.segments.flatMap((segment) => segment.polyline) : [],
    )
    .find((p) => p.y > 46 && p.y < 54);
  if (point === undefined) throw new Error('Expected emitted scan rows inside the fixture island');
  return point.y;
}

describe('K1 operation topology survives process settings', () => {
  it.each([
    { name: 'power scale', settings: { powerScale: 50 } },
    {
      name: 'speed override',
      settings: { operationOverride: { byOperation: { operation: { speed: 600 } } } },
    },
  ])('keeps a separate hole inward with a $name', ({ settings }) => {
    const job = compile([plate, { ...hole, ...settings }], layer({ kerfOffsetMm: 1 }));
    expect(sortedWidths(job)).toEqual([102, 18]);
    expect(job.groups.every((group) => group.kind === 'cut')).toBe(true);
  });

  it('counts a kerf-zero plate as the container of a separately compensated hole', () => {
    const zeroPlate = {
      ...plate,
      operationOverride: { byOperation: { operation: { kerfOffsetMm: 0 } } },
    };
    const job = compile([zeroPlate, hole], layer({ kerfOffsetMm: 1 }));
    expect(sortedWidths(job)).toEqual([100, 18]);
  });

  it('interleaves a depth-two island, a differently fed hole, and their outer plate', () => {
    const fedHole = { ...hole, operationOverride: { byOperation: { operation: { speed: 600 } } } };
    const optimized = optimizePaths(compile([plate, island, fedHole]));
    expect(widths(optimized)).toEqual([10, 20, 100]);
    const groups = optimized.groups.flatMap((group) => (group.kind === 'cut' ? [group] : []));
    expect(groups.map((group) => group.speed)).toEqual([1200, 600, 1200]);
    expect(groups.map((group) => group.passes)).toEqual([2, 2, 2]);
    expect(groups.map((group) => group.power)).toEqual([80, 80, 80]);
  });

  it('control: source order retains the user-selected process-group traversal', () => {
    const fedHole = { ...hole, operationOverride: { byOperation: { operation: { speed: 600 } } } };
    const optimized = optimizePaths(compile([plate, island, fedHole]), {
      travelPolicy: 'source-order',
      insideFirst: true,
      layerPriority: 'project-order',
      pathDirection: 'allow-reverse',
      startPoint: 'machine-origin',
    });
    expect(widths(optimized)).toEqual([100, 10, 20]);
    expect(optimized.groups.map((group) => (group.kind === 'cut' ? group.passes : 0))).toEqual([
      2, 2,
    ]);
  });

  it('does not engrave a hole when its object has another power setting', () => {
    const job = compile(
      [plate, { ...hole, powerScale: 50 }],
      layer({
        mode: 'fill',
        fillStyle: 'scanline',
        hatchAngleDeg: 0,
        hatchSpacingMm: 1,
      }),
    );
    const y = interiorScanY(job);
    expect(fillOwnersAt(job, 20, y)).toEqual([80]);
    expect(fillOwnersAt(job, 50, y)).toEqual([]);
  });

  it('engraves an island once with its own power while retaining the surrounding hole', () => {
    const job = compile(
      [plate, { ...hole, powerScale: 50 }, { ...island, powerScale: 25 }],
      layer({
        mode: 'fill',
        fillStyle: 'scanline',
        hatchAngleDeg: 0,
        hatchSpacingMm: 1,
      }),
    );
    const y = interiorScanY(job);
    expect(fillOwnersAt(job, 20, y)).toEqual([80]);
    expect(fillOwnersAt(job, 42, y)).toEqual([]);
    expect(fillOwnersAt(job, 50, y)).toEqual([20]);
  });

  it('control: a uniform Fill already retains both the void and its material island', () => {
    const job = compile(
      [plate, hole, island],
      layer({
        mode: 'fill',
        fillStyle: 'scanline',
        hatchAngleDeg: 0,
        hatchSpacingMm: 1,
      }),
    );
    const y = interiorScanY(job);
    expect(fillOwnersAt(job, 20, y)).toEqual([80]);
    expect(fillOwnersAt(job, 42, y)).toEqual([]);
    expect(fillOwnersAt(job, 50, y)).toEqual([80]);
  });

  it("control: contours assigned to separate operations do not change each other's kerf side", () => {
    const assigned = (object: ImportedSvg, operationId: string): ImportedSvg => ({
      ...object,
      paths: object.paths.map((path) => ({ ...path, operationIds: [operationId] })),
    });
    const job = compileJob(
      {
        objects: [assigned(plate, 'operation'), assigned(hole, 'second')],
        layers: [layer({ kerfOffsetMm: 1 }), { ...layer({ kerfOffsetMm: 1 }), id: 'second' }],
      },
      device,
    );
    expect(sortedWidths(job)).toEqual([102, 22]);
  });

  it('control: a Fill override contributes no container to the Line topology', () => {
    const fillHole = {
      ...hole,
      operationOverride: {
        byOperation: { operation: { mode: 'fill' as const, hatchSpacingMm: 1 } },
      },
    };
    const job = compile([plate, fillHole], layer({ kerfOffsetMm: 1 }));
    expect(sortedWidths(job)).toEqual([102]);
    expect(job.groups.some((group) => group.kind === 'fill')).toBe(true);
  });

  it('control: coincident contours with different power stay separate outer cuts', () => {
    const job = compile(
      [plate, { ...plate, id: 'copy', powerScale: 50 }],
      layer({ kerfOffsetMm: 1 }),
    );
    expect(sortedWidths(job)).toEqual([102, 102]);
    expect(
      job.groups
        .flatMap((group) => (group.kind === 'cut' ? [group.power] : []))
        .sort((a, b) => a - b),
    ).toEqual([40, 80]);
  });
});
