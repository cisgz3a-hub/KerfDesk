import { describe, expect, it } from 'vitest';
import type { CncContourPass, CncGroup } from '../job/job';
import { cncGroupMaximumDepthMm } from './cnc-group-maximum-depth';

function contour(zMm: number, xs: ReadonlyArray<number>): CncContourPass {
  return {
    kind: 'contour',
    zMm,
    closed: false,
    polyline: xs.map((x) => ({ x, y: 10 })),
  };
}

function group(passes: ReadonlyArray<CncContourPass>): CncGroup {
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
});
