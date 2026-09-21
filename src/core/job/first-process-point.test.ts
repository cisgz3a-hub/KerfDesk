import { describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '../scene';
import { firstToolpathProcessPoint } from './first-process-point';
import type {
  CncGroup,
  CncPass,
  CutGroup,
  FillGroup,
  FillSegment,
  Group,
  Job,
  RasterGroup,
} from './job';
import { buildToolpath, type BuildToolpathOptions } from './toolpath';

const OPTIONS: BuildToolpathOptions = {
  startPoint: { x: -20, y: -20 },
  parkPoint: { x: 0, y: 0 },
  bedSizeMm: { widthMm: 300, heightMm: 300 },
  scanningOffsets: [{ speedMmPerMin: 1000, offsetMm: 0.27 }],
};

function cut(overrides: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'outline',
    color: '#000',
    power: 40,
    speed: 1000,
    passes: 2,
    airAssist: false,
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
        closed: false,
      },
    ],
    ...overrides,
  };
}

function span(x1: number, x2: number, y: number, reverse = false): FillSegment {
  return {
    polyline: [
      { x: x1, y },
      { x: x2, y },
    ],
    closed: false,
    reverse,
  };
}

function fill(overrides: Partial<FillGroup> = {}): FillGroup {
  return { ...cut(), kind: 'fill', overscanMm: 3, segments: [span(10, 20, 10)], ...overrides };
}

function raster(overrides: Partial<RasterGroup> = {}): RasterGroup {
  return {
    ...cut(),
    kind: 'raster',
    pixelWidth: 4,
    pixelHeight: 3,
    bounds: { minX: 10, minY: 20, maxX: 14, maxY: 23 },
    sValues: new Uint16Array([0, 0, 0, 0, 500, 0, 0, 0, 500, 500, 500, 500]),
    overscanMm: 3,
    dotWidthCorrectionMm: 0,
    ...overrides,
  };
}

function cnc(passes: ReadonlyArray<CncPass>): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'cnc',
    color: '#f00',
    cutType: 'engrave',
    toolDiameterMm: 3,
    feedMmPerMin: 1000,
    plungeMmPerMin: 200,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 5,
    passes,
  };
}

function xy(point: Vec2 | null): Vec2 | null {
  return point === null ? null : { x: point.x, y: point.y };
}

function expectParity(groups: ReadonlyArray<Group>, options = OPTIONS): void {
  const job: Job = { groups };
  const step = buildToolpath(job, options).steps.find((candidate) => candidate.kind === 'cut');
  const expected = step?.kind === 'cut' ? (step.polyline[0] ?? null) : null;
  expect(xy(firstToolpathProcessPoint(job, options))).toEqual(xy(expected));
}

describe('firstToolpathProcessPoint parity', () => {
  it('skips empty/no-pass groups and keeps contour entry and park travel out of the process marker', () => {
    expectParity([]);
    expectParity([cut({ passes: 0 }), cut({ segments: [] })]);
    expectParity([cut({ segments: [] }), cut({ entryRunwayMm: 8 })]);
    expectParity([cut({ segments: [{ polyline: [{ x: 4, y: 8 }], closed: false }] })]);
    expectParity([fill({ fillStyle: 'offset', entryRunwayMm: 8 })]);
    expect(firstToolpathProcessPoint({ groups: [cut({ entryRunwayMm: 8 })] }, OPTIONS)).toEqual({
      x: 10,
      y: 10,
    });
  });

  it.each<FillGroup['fillRunwayPolicy']>([
    undefined,
    'full',
    'raster-full',
    'raster-bounded',
    'feed-matched-entry',
    'feed-matched-every-sweep',
  ])(
    'preserves fill sweep sorting, gaps, offsets, reversal and degenerate filtering for %s',
    (policy) => {
      for (const reverse of [false, true]) {
        for (const override of [undefined, 0, 0.45]) {
          const segments = [
            span(1, 1, 2, reverse),
            span(3, 3.0001, 3, reverse),
            span(reverse ? 24 : 23, reverse ? 23 : 24, 5, reverse),
            span(reverse ? 14 : 12, reverse ? 12 : 14, 5, reverse),
            span(7, 9, 6, reverse),
          ];
          expectParity([
            fill({
              segments,
              ...(policy === undefined ? {} : { fillRunwayPolicy: policy }),
              ...(override === undefined ? {} : { bidirectionalScanOffsetMm: override }),
            }),
          ]);
        }
      }
    },
  );

  it('uses the same rotated fill scanline and island policy as the full route', () => {
    const group = fill({
      fillStyle: 'island',
      islandMotionPolicy: 'sensitive',
      segments: [
        {
          ...span(0, 0, 0, true),
          polyline: [
            { x: 20, y: 30 },
            { x: 18, y: 28 },
          ],
        },
        {
          ...span(0, 0, 0, true),
          polyline: [
            { x: 30, y: 40 },
            { x: 29, y: 39 },
          ],
        },
        {
          ...span(0, 0, 0, true),
          polyline: [
            { x: 20, y: 31 },
            { x: 18, y: 29 },
          ],
        },
      ],
    });
    expectParity([group]);
  });

  it.each([0, 0.25, 0.6])(
    'preserves raster rows, correction %s and reversal after a corrected-away row',
    (correction) => {
      for (const bidirectional of [false, true]) {
        for (const rowProviderOrder of ['ascending-y', 'descending-y'] as const) {
          expectParity([
            raster({ dotWidthCorrectionMm: correction, bidirectional, rowProviderOrder }),
          ]);
        }
      }
      expectParity([raster({ sValues: new Uint16Array(12) }), cut()]);
      expectParity([raster({ pixelWidth: 0 }), cut()]);
    },
  );

  it.each<CncPass>([
    {
      kind: 'contour',
      zMm: -2,
      polyline: [
        { x: 1.23456, y: 3.45678 },
        { x: 2, y: 4 },
      ],
      closed: false,
    },
    {
      kind: 'contour',
      zMm: -2,
      polyline: [
        { x: 1.23456, y: 3.45678 },
        { x: 1.23458, y: 3.45679 },
      ],
      closed: false,
    },
    {
      kind: 'contour',
      zMm: -2,
      polyline: [
        { x: 1, y: 2 },
        { x: 1, y: 2 },
      ],
      closed: false,
    },
    {
      kind: 'path3d',
      points: [
        { x: 2.34567, y: 4.56789, z: -1 },
        { x: 5, y: 8, z: -2 },
      ],
      closed: false,
    },
    {
      kind: 'arc',
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 },
      center: { x: 0, y: 0 },
      clockwise: false,
      zMm: -2,
      closed: false,
    },
    {
      kind: 'arc',
      start: { x: 10, y: 0 },
      end: { x: 10, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: false,
      zMm: -2,
      closed: true,
    },
    {
      kind: 'arc',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: false,
      zMm: -2,
      closed: false,
    },
    {
      kind: 'helical-contour',
      start: { x: 10, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: true,
      startZMm: 0,
      zMm: -2,
      revolutions: 2,
      polyline: [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      closed: false,
    },
  ])('preserves the first represented CNC cut for $kind', (pass) => {
    expectParity([cnc([pass]), cut()]);
  });
});

describe('firstToolpathProcessPoint bounded access', () => {
  const inaccessible = <T>(message: string): T =>
    new Proxy({} as T & object, {
      get() {
        throw new Error(message);
      },
    });

  it('does not walk later contours or groups after the first cut', () => {
    const first = cut();
    const groups = [
      cut({ segments: [...first.segments, inaccessible('late contour')] }),
      inaccessible<Group>('late group'),
    ];
    expect(firstToolpathProcessPoint({ groups })).toEqual({ x: 10, y: 10 });
  });

  it('plans only the first fill scanline plus one boundary lookahead, even with many passes', () => {
    const group = fill({
      passes: 1000000,
      segments: [
        span(20, 25, 10),
        span(5, 10, 10),
        span(30, 35, 11),
        inaccessible('late scanline'),
      ],
    });
    expect(
      firstToolpathProcessPoint({ groups: [group, inaccessible<Group>('late group')] }),
    ).toEqual({ x: 5, y: 10 });
  });

  it('does not request raster provider rows after the first retained positive-power run', () => {
    const rowProvider = vi.fn((y: number) => {
      if (y > 1) throw new Error('late raster row');
      return new Uint16Array(y === 0 ? [0, 0, 0, 0] : [0, 500, 500, 0]);
    });
    const group = raster({ rowProvider, passes: 1000000 });
    expect(firstToolpathProcessPoint({ groups: [group] })).toEqual({ x: 11, y: 21.5 });
    expect(rowProvider.mock.calls).toEqual([[0], [1]]);
  });

  it('does not traverse later CNC passes or expand a multi-turn helix to find its start', () => {
    const pass: CncPass = {
      kind: 'helical-contour',
      start: { x: 10, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: true,
      startZMm: 0,
      zMm: -2,
      revolutions: 1000000,
      polyline: [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      closed: false,
    };
    expect(
      firstToolpathProcessPoint({ groups: [cnc([pass, inaccessible('late CNC pass')])] }),
    ).toEqual({ x: 10, y: 0 });
  });
});
