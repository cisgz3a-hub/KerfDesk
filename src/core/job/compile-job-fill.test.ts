import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type SceneObject, type Transform } from '../scene';
import { compileJob } from './compile-job';
import type { FillGroup, Job } from './job';

const dev = DEFAULT_DEVICE_PROFILE;

function firstFillGroup(job: Job): FillGroup | undefined {
  const group = job.groups[0];
  return group?.kind === 'fill' ? group : undefined;
}

function fillGroups(job: Job): FillGroup[] {
  return job.groups.filter((group): group is FillGroup => group.kind === 'fill');
}

function closedSquareObj(args: {
  readonly id: string;
  readonly color: string;
  readonly x?: number;
  readonly y?: number;
  readonly size: number;
  readonly transform?: Transform;
}): SceneObject {
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

function groupCenter(fill: FillGroup): { readonly x: number; readonly y: number } {
  const points = fill.segments.flatMap((segment) => segment.polyline);
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
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

  it('preserves reverse metadata for bidirectional and cross-hatch fill segments', () => {
    const layer = { ...fillLayer(), hatchSpacingMm: 1, fillCrossHatch: true };
    const square = closedSquareObj({ id: 'square', color: '#ff0000', size: 4 });

    const fill = firstFillGroup(compileJob({ objects: [square], layers: [layer] }, dev));
    const segments = fill?.segments ?? [];

    expect(segments.some((segment) => segment.reverse === false)).toBe(true);
    expect(segments.some((segment) => segment.reverse === true)).toBe(true);
    expect(segments.filter(isHorizontalSegment).some((segment) => segment.reverse)).toBe(true);
    expect(segments.filter(isVerticalSegment).some((segment) => segment.reverse)).toBe(true);
  });

  it('selects feed-matched scanline entries only for the 4040-safe profile', () => {
    const layer = fillLayer();
    const square = closedSquareObj({ id: 'square', color: '#ff0000', size: 4 });
    const generic = firstFillGroup(compileJob({ objects: [square], layers: [layer] }, dev));
    const safe4040 = firstFillGroup(
      compileJob({ objects: [square], layers: [layer] }, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
    );

    expect(generic?.fillRunwayPolicy).toBeUndefined();
    expect(safe4040?.fillRunwayPolicy).toBe('feed-matched-entry');
  });

  it('applies 4040 one-way fallback and bounded entry runway, then permits calibrated or expert bidirectional fill', () => {
    const square = closedSquareObj({ id: 'square', color: '#ff0000', size: 4 });
    const requested = fillLayer();
    const fallback = firstFillGroup(
      compileJob({ objects: [square], layers: [requested] }, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
    );
    const calibrated = firstFillGroup(
      compileJob(
        { objects: [square], layers: [requested] },
        {
          ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
          scanningOffsets: [{ speedMmPerMin: requested.speed, offsetMm: 0.1 }],
        },
      ),
    );
    const expert = firstFillGroup(
      compileJob(
        {
          objects: [square],
          layers: [{ ...requested, allowUncalibratedBidirectionalScan: true }],
        },
        NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      ),
    );

    expect(fallback).toMatchObject({
      fillRunwayPolicy: 'feed-matched-entry',
      scanDirection: { bidirectional: false, reason: 'uncalibrated-4040-fallback' },
    });
    expect(fallback?.segments.every((segment) => !segment.reverse)).toBe(true);
    expect(calibrated?.scanDirection).toEqual({
      bidirectional: true,
      reason: 'calibrated-bidirectional',
    });
    expect(calibrated?.segments.some((segment) => segment.reverse)).toBe(true);
    expect(expert?.scanDirection).toEqual({ bidirectional: true, reason: 'expert-override' });
    expect(expert?.segments.some((segment) => segment.reverse)).toBe(true);
  });

  it('compiles Island Fill as one scanline fill group per separate island', () => {
    const layer = { ...fillLayer(), fillStyle: 'island' as never };
    const left = closedSquareObj({ id: 'left', color: '#ff0000', size: 6 });
    const right = closedSquareObj({ id: 'right', color: '#ff0000', x: 30, size: 6 });

    const fills = fillGroups(compileJob({ objects: [left, right], layers: [layer] }, dev));

    expect(fills).toHaveLength(2);
    expect(fills.every((fill) => fill.fillStyle === 'island')).toBe(true);
    expect(
      fills.every((fill) => fill.segments.every((segment) => segment.polyline.length === 2)),
    ).toBe(true);
  });

  it('keeps nearby tiny Island Fill letters separate on generic GRBL profiles', () => {
    const layer = { ...fillLayer(), fillStyle: 'island' as never };
    const a = closedSquareObj({ id: 'letter-a', color: '#ff0000', size: 3 });
    const b = closedSquareObj({ id: 'letter-b', color: '#ff0000', x: 4.5, size: 3 });

    const fills = fillGroups(compileJob({ objects: [a, b], layers: [layer] }, dev));

    expect(fills).toHaveLength(2);
    expect(fills.every((fill) => fill.islandMotionPolicy === undefined)).toBe(true);
  });

  it('clusters nearby tiny Island Fill letters and forces unidirectional sweeps on the 4040-safe profile', () => {
    const layer = { ...fillLayer(), fillStyle: 'island' as never, fillBidirectional: true };
    const a = closedSquareObj({ id: 'letter-a', color: '#ff0000', size: 3 });
    const b = closedSquareObj({ id: 'letter-b', color: '#ff0000', x: 4.5, size: 3 });

    const fills = fillGroups(
      compileJob({ objects: [a, b], layers: [layer] }, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
    );

    expect(fills).toHaveLength(1);
    expect(fills[0]?.islandMotionPolicy).toBe('sensitive');
    expect(fills[0]?.scanDirection).toEqual({
      bidirectional: false,
      reason: 'sensitive-island-one-way',
    });
    expect(fills[0]?.segments.every((segment) => !segment.reverse)).toBe(true);
    expect(segmentsAtMachineY(fills[0], dev.bedHeight - 1)).toHaveLength(2);
  });

  it('does not let calibration or an expert override overturn sensitive 4040 Island Fill one-way motion', () => {
    const square = closedSquareObj({ id: 'square', color: '#ff0000', size: 6 });
    const requested = { ...fillLayer(), fillStyle: 'island' as never };
    const calibrated = firstFillGroup(
      compileJob(
        { objects: [square], layers: [requested] },
        {
          ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
          scanningOffsets: [{ speedMmPerMin: requested.speed, offsetMm: 0.1 }],
        },
      ),
    );
    const expert = firstFillGroup(
      compileJob(
        {
          objects: [square],
          layers: [{ ...requested, allowUncalibratedBidirectionalScan: true }],
        },
        NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      ),
    );

    for (const group of [calibrated, expert]) {
      expect(group?.scanDirection).toEqual({
        bidirectional: false,
        reason: 'sensitive-island-one-way',
      });
      expect(group?.segments.every((segment) => !segment.reverse)).toBe(true);
    }
  });

  it('does not cluster distant tiny Island Fill artwork on the 4040-safe profile', () => {
    const layer = { ...fillLayer(), fillStyle: 'island' as never };
    const left = closedSquareObj({ id: 'left', color: '#ff0000', size: 3 });
    const right = closedSquareObj({ id: 'right', color: '#ff0000', x: 50, size: 3 });

    const fills = fillGroups(
      compileJob(
        { objects: [left, right], layers: [layer] },
        NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      ),
    );

    expect(fills).toHaveLength(2);
  });

  it('keeps Island Fill holes with their containing outer contour', () => {
    const layer = { ...fillLayer(), fillStyle: 'island' as never };
    const outer = closedSquareObj({ id: 'outer', color: '#ff0000', size: 12 });
    const inner = closedSquareObj({ id: 'inner', color: '#ff0000', x: 4, y: 4, size: 4 });

    const fills = fillGroups(compileJob({ objects: [outer, inner], layers: [layer] }, dev));

    expect(fills).toHaveLength(1);
    expect(segmentsAtMachineY(fills[0], dev.bedHeight - 6)).toHaveLength(2);
  });

  it('orders Island Fill outer islands clockwise before center islands', () => {
    const layer = { ...fillLayer(), fillStyle: 'island' as never };
    const top = closedSquareObj({ id: 'top', color: '#ff0000', x: 20, y: 60, size: 4 });
    const right = closedSquareObj({ id: 'right', color: '#ff0000', x: 60, y: 20, size: 4 });
    const bottom = closedSquareObj({ id: 'bottom', color: '#ff0000', x: 20, y: -20, size: 4 });
    const left = closedSquareObj({ id: 'left', color: '#ff0000', x: -20, y: 20, size: 4 });
    const center = closedSquareObj({ id: 'center', color: '#ff0000', x: 20, y: 20, size: 4 });

    const fills = fillGroups(
      compileJob({ objects: [center, left, bottom, right, top], layers: [layer] }, dev),
    );
    const centers = fills.map(groupCenter);

    expect(fills).toHaveLength(5);
    expect(centers.map((centerPoint) => Math.round(centerPoint.x))).toEqual([22, 62, 22, -18, 22]);
    expect(Math.round(centers[4]?.y ?? 0)).toBe(dev.bedHeight - 22);
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
