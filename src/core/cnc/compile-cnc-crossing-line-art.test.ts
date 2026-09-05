import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { selectLineArtContours, type LineArtContourSide } from './line-art-contours';

function ring(points: ReadonlyArray<readonly [number, number]>): Polyline {
  return { closed: true, points: points.map(([x, y]) => ({ x, y })) };
}

const SQUARE = ring([
  [0, 0],
  [40, 0],
  [40, 40],
  [0, 40],
]);
const NOTCHED = ring([
  [0, 0],
  [40, 0],
  [40, 40],
  [30, 40],
  [30, 10],
  [10, 10],
  [10, 40],
  [0, 40],
]);
const INSET = ring([
  [1, 1],
  [39, 1],
  [39, 39],
  [1, 39],
]);
const TOUCHING = ring([
  [1, 1],
  [40, 1],
  [40, 39],
  [1, 39],
]);

function sceneWith(polylines: ReadonlyArray<Polyline>, side: LineArtContourSide): Scene {
  return {
    layers: [
      {
        ...createLayer({ id: 'cut', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'profile-on-path',
          depthMm: 1,
          depthPerPassMm: 1,
          tabsEnabled: false,
          lineArtContours: side,
        },
      },
    ],
    objects: [
      {
        kind: 'imported-svg',
        id: 'outlines',
        source: 'outlines.svg',
        bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: '#ff0000', polylines }],
      },
    ],
  };
}

describe.each([
  ['crossing a concave notch with every vertex inside', [NOTCHED, INSET]],
  [
    'crossing on the closing edge',
    [NOTCHED, { ...INSET, points: [...INSET.points.slice(3), ...INSET.points.slice(0, 3)] }],
  ],
  ['touching at an edge', [SQUARE, TOUCHING]],
  ['coincident with identical winding', [SQUARE, { ...SQUARE, points: [...SQUARE.points] }]],
  [
    'coincident with reversed winding',
    [SQUARE, { ...SQUARE, points: [...SQUARE.points].reverse() }],
  ],
] as const)('line-art outlines %s', (_name, original) => {
  it.each(['inner', 'outer', 'both'] as const)('preserves both contours for %s', (side) => {
    for (const reflected of [false, true]) {
      const polylines = original.map((polyline) => ({
        ...polyline,
        points: polyline.points.map(({ x, y }) =>
          reflected ? { x: 80 - x * 2, y: 10 + y * 2 } : { x, y },
        ),
      }));
      expect(selectLineArtContours(polylines, side, 6.35)).toBe(polylines);
      const job = compileCncJob(
        sceneWith(polylines, side),
        DEFAULT_DEVICE_PROFILE,
        DEFAULT_CNC_MACHINE_CONFIG,
      );
      const both = compileCncJob(
        sceneWith(polylines, 'both'),
        DEFAULT_DEVICE_PROFILE,
        DEFAULT_CNC_MACHINE_CONFIG,
      );
      const group = job.groups[0];
      expect(group?.kind).toBe('cnc');
      if (group?.kind !== 'cnc') throw new Error('Expected CNC output');
      expect(group.passes).toHaveLength(2);
      expect(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)).toEqual(
        cncGrblStrategy.emit(both, DEFAULT_DEVICE_PROFILE),
      );
    }
  });
});
