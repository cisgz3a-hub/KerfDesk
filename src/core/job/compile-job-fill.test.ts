import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type SceneObject,
  type Transform,
} from '../scene';
import { compileJob } from './compile-job';
import type { FillGroup, Job } from './job';

const dev = DEFAULT_DEVICE_PROFILE;

function firstFillGroup(job: Job): FillGroup | undefined {
  const group = job.groups[0];
  return group?.kind === 'fill' ? group : undefined;
}

function closedSquareObj(args: {
  readonly id: string;
  readonly color: string;
  readonly x?: number;
  readonly y?: number;
  readonly size: number;
  readonly transform?: Transform;
}): ImportedSvg {
  const x = args.x ?? 0;
  const y = args.y ?? 0;
  const points = [
    { x, y },
    { x: x + args.size, y },
    { x: x + args.size, y: y + args.size },
    { x, y: y + args.size },
  ];
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${args.id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + args.size, maxY: y + args.size },
    transform: args.transform ?? IDENTITY_TRANSFORM,
    paths: [{ color: args.color, polylines: [{ points, closed: true }] }],
  };
}

function textWithOverlappingContours(color: string): SceneObject {
  const left = closedSquareObj({ id: 'left-glyph', color, size: 10 });
  const right = closedSquareObj({ id: 'right-glyph', color, x: 5, size: 10 });
  return {
    kind: 'text',
    id: 'script-text',
    content: 'Carina',
    fontKey: 'dancing-script',
    sizeMm: 20,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color,
    bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [...left.paths, ...right.paths],
  };
}

function segmentsAtMachineY(
  fill: FillGroup | undefined,
  y: number,
): ReadonlyArray<{ readonly minX: number; readonly maxX: number; readonly length: number }> {
  return (fill?.segments ?? [])
    .filter((seg) => {
      const a = seg.polyline[0];
      const b = seg.polyline[1];
      return (
        a !== undefined && b !== undefined && Math.abs(a.y - y) < 1e-6 && Math.abs(b.y - y) < 1e-6
      );
    })
    .map((seg) => {
      const a = seg.polyline[0];
      const b = seg.polyline[1];
      if (a === undefined || b === undefined) return { minX: 0, maxX: 0, length: 0 };
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      return { minX, maxX, length: maxX - minX };
    });
}

function fillLayer(color = '#ff0000'): ReturnType<typeof createLayer> {
  return {
    ...createLayer({ id: color, color }),
    mode: 'fill',
    hatchSpacingMm: 1,
    hatchAngleDeg: 0,
  };
}

describe('compileJob fill hatching', () => {
  it('keeps hatch spacing physical after object scale', () => {
    const layer = fillLayer();
    const scaled = closedSquareObj({
      id: 'scaled',
      color: '#ff0000',
      size: 10,
      transform: { ...IDENTITY_TRANSFORM, scaleY: 2 },
    });

    const fill = firstFillGroup(compileJob({ objects: [scaled], layers: [layer] }, dev));
    const ys = [...new Set((fill?.segments ?? []).map((seg) => seg.polyline[0]?.y))]
      .filter((y): y is number => y !== undefined)
      .sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => y - (ys[i] ?? y));

    expect(gaps.length).toBeGreaterThan(5);
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(1, 6);
    }
  });

  it('aggregates separate same-layer nested objects into a hole interaction', () => {
    const layer = fillLayer();
    const outer = closedSquareObj({ id: 'outer', color: '#ff0000', size: 10 });
    const inner = closedSquareObj({ id: 'inner', color: '#ff0000', x: 3, y: 3, size: 4 });

    const fill = firstFillGroup(compileJob({ objects: [outer, inner], layers: [layer] }, dev));
    const row = segmentsAtMachineY(fill, dev.bedHeight - 5);

    expect(row).toHaveLength(2);
    for (const segment of row) {
      expect(segment.length).toBeLessThan(7);
    }
  });

  it('aggregates separate same-layer partial overlaps without double engraving the overlap', () => {
    const layer = fillLayer();
    const left = closedSquareObj({ id: 'left', color: '#ff0000', size: 10 });
    const right = closedSquareObj({ id: 'right', color: '#ff0000', x: 5, size: 10 });

    const fill = firstFillGroup(compileJob({ objects: [left, right], layers: [layer] }, dev));
    const row = segmentsAtMachineY(fill, dev.bedHeight - 5);
    const totalBurnLength = row.reduce((sum, segment) => sum + segment.length, 0);

    expect(row).toHaveLength(2);
    expect(totalBurnLength).toBeCloseTo(10);
    expect(row.some((segment) => segment.minX < 10 && segment.maxX > 5)).toBe(false);
  });

  it('fills overlapping text contours as a union so script glyph joins do not go hollow', () => {
    const layer = fillLayer();
    const script = textWithOverlappingContours('#ff0000');

    const fill = firstFillGroup(compileJob({ objects: [script], layers: [layer] }, dev));
    const row = segmentsAtMachineY(fill, dev.bedHeight - 5);

    expect(row).toHaveLength(1);
    expect(row[0]?.length).toBeCloseTo(15);
  });

  it('keeps different fill layers separate so overlaps can engrave twice', () => {
    const red = fillLayer('#ff0000');
    const blue = fillLayer('#0000ff');
    const left = closedSquareObj({ id: 'left', color: '#ff0000', size: 10 });
    const right = closedSquareObj({ id: 'right', color: '#0000ff', x: 5, size: 10 });

    const job = compileJob({ objects: [left, right], layers: [red, blue] }, dev);

    expect(job.groups).toHaveLength(2);
    expect(segmentsAtMachineY(job.groups[0] as FillGroup, dev.bedHeight - 5)[0]?.length).toBe(10);
    expect(segmentsAtMachineY(job.groups[1] as FillGroup, dev.bedHeight - 5)[0]?.length).toBe(10);
  });

  it('emits a second 90 degree fill set when cross-hatch is enabled', () => {
    const layer = { ...fillLayer(), fillCrossHatch: true };
    const square = closedSquareObj({ id: 'square', color: '#ff0000', size: 4 });

    const fill = firstFillGroup(compileJob({ objects: [square], layers: [layer] }, dev));
    const segments = fill?.segments ?? [];

    expect(segments.some(isHorizontalSegment)).toBe(true);
    expect(segments.some(isVerticalSegment)).toBe(true);
  });

  it('compiles offset fill as contour-following closed paths', () => {
    const layer = { ...fillLayer(), fillStyle: 'offset' as const, hatchSpacingMm: 2 };
    const square = closedSquareObj({ id: 'square', color: '#ff0000', size: 10 });

    const fill = firstFillGroup(compileJob({ objects: [square], layers: [layer] }, dev));
    const segments = fill?.segments ?? [];

    expect(fill).toMatchObject({ kind: 'fill', fillStyle: 'offset' });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.closed)).toBe(true);
    expect(segments.every((segment) => segment.polyline.length > 2)).toBe(true);
  });
});

function isHorizontalSegment(segment: FillGroup['segments'][number]): boolean {
  const a = segment.polyline[0];
  const b = segment.polyline[1];
  return a !== undefined && b !== undefined && Math.abs(a.y - b.y) < 1e-6;
}

function isVerticalSegment(segment: FillGroup['segments'][number]): boolean {
  const a = segment.polyline[0];
  const b = segment.polyline[1];
  return a !== undefined && b !== undefined && Math.abs(a.x - b.x) < 1e-6;
}
