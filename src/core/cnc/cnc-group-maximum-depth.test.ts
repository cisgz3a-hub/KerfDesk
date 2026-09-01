import { describe, expect, it } from 'vitest';
import type { CncContourPass, CncGroup, CncPass } from '../job/job';
import { parseGrblCncCoordinate } from './cnc-grbl-coordinate-parser';
import { formatCncCoordinateMm } from './cnc-output-precision';
import { cncGroupMaximumDepth, cncGroupMaximumDepthMm } from './cnc-group-maximum-depth';

function contour(zMm: number, xs: ReadonlyArray<number>): CncContourPass {
  return {
    kind: 'contour',
    zMm,
    closed: false,
    polyline: xs.map((x) => ({ x, y: 10 })),
  };
}

function group(passes: ReadonlyArray<CncPass>): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'vcarve',
    color: '#000000',
    cutType: 'v-carve',
    toolDiameterMm: 3.175,
    feedMmPerMin: 600,
    plungeMmPerMin: 180,
    spindleRpm: 12_000,
    spindleSpinupSec: 2,
    safeZMm: 5,
    passes,
  };
}

describe('cncGroupMaximumDepthMm emitted depth', () => {
  it('ignores a deeper contour when every requested segment is emissionless', () => {
    expect(
      cncGroupMaximumDepthMm(group([contour(-7, [247.01767, 247.01768]), contour(-2, [0, 10])])),
    ).toBe(2);
  });

  it('reports zero when every contour is emissionless', () => {
    expect(cncGroupMaximumDepthMm(group([contour(-7, [247.01767, 247.01768])]))).toBe(0);
  });

  it('retains the depth of a partially represented contour', () => {
    expect(cncGroupMaximumDepthMm(group([contour(-7, [10_000, 10_010, 10_010.0004])]))).toBe(7);
  });

  it.each([
    ['contour', contour(-0.0506, [0, 10])],
    [
      'arc',
      {
        kind: 'arc',
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        center: { x: 0, y: 0 },
        clockwise: false,
        zMm: -0.0506,
        closed: false,
      },
    ],
    [
      'path3d',
      {
        kind: 'path3d',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: -0.0506 },
        ],
        closed: false,
      },
    ],
    [
      'helical-contour',
      {
        kind: 'helical-contour',
        start: { x: 1, y: 0 },
        center: { x: 0, y: 0 },
        clockwise: false,
        startZMm: 0,
        zMm: -0.0506,
        revolutions: 2,
        polyline: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        closed: false,
      },
    ],
  ] as const)('reports the %s pass depth represented in emitted bytes', (_kind, pass) => {
    expect(formatCncCoordinateMm(cncGroupMaximumDepthMm(group([pass])))).toBe('0.051');
  });

  it.each([
    [-0.05049, 0.05],
    [-0.0505, 0.051],
    [-0.00049, 0],
  ] as const)('pins half-quantum contour depth %s to effective %s', (zMm, depthMm) => {
    expect(formatCncCoordinateMm(cncGroupMaximumDepthMm(group([contour(zMm, [0, 10])])))).toBe(
      depthMm.toFixed(3),
    );
  });

  it('retains non-idempotent emitted text beside the controller value', () => {
    expect(cncGroupMaximumDepth(group([contour(-6553.606, [0, 10])]))).toEqual({
      text: '6553.606',
      value: -parseGrblCncCoordinate('-6553.606'),
    });
    expect(formatCncCoordinateMm(parseGrblCncCoordinate('6553.606'))).toBe('6553.605');
  });

  it.each([
    ['one-point path3d', { kind: 'path3d', points: [{ x: 0, y: 0, z: -2 }], closed: false }],
    [
      'one-point helix contour',
      {
        kind: 'helical-contour',
        start: { x: 1, y: 0 },
        center: { x: 0, y: 0 },
        clockwise: false,
        startZMm: 0,
        zMm: -2,
        revolutions: 1,
        polyline: [{ x: 1, y: 0 }],
        closed: false,
      },
    ],
    [
      'zero-radius arc',
      {
        kind: 'arc',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
        center: { x: 0, y: 0 },
        clockwise: false,
        zMm: -2,
        closed: false,
      },
    ],
  ] as const)('ignores an emissionless %s', (_name, pass) => {
    expect(cncGroupMaximumDepthMm(group([pass]))).toBe(0);
  });
});
