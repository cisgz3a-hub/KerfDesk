import { afterEach, expect, it, vi } from 'vitest';
import type { CncGroup, CncPass } from '../job';
import * as distance from '../min-feature/segment-distance';
import { createLayer } from '../scene';
import { cncKeptPartCuts } from './cnc-kept-part-cuts';
import type { ProfileLeadKeptWall } from './profile-lead-kept-walls';

const layer = createLayer({ id: 'cut', color: '#ff0000' });
const wall: ProfileLeadKeptWall = {
  layerId: 'kept',
  ring: [
    { x: 19, y: 4 },
    { x: 21, y: 4 },
    { x: 21, y: 6 },
    { x: 19, y: 6 },
  ],
  minX: 19,
  minY: 4,
  maxX: 21,
  maxY: 6,
  keptInside: true,
  clearedMm: 0,
};

function pass(z: number): CncPass {
  return {
    kind: 'path3d',
    closed: true,
    points: [
      { x: 0, y: 0, z },
      { x: 20, y: 0, z },
      { x: 20, y: 10, z },
      { x: 0, y: 10, z },
      { x: 0, y: 0, z },
    ],
  };
}

function cuts(passes: ReadonlyArray<CncPass>) {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType: 'profile-on-path',
    toolDiameterMm: 2,
    feedMmPerMin: 600,
    plungeMmPerMin: 100,
    spindleRpm: 10000,
    spindleSpinupSec: 0,
    safeZMm: 5,
    passes,
  };
  return cncKeptPartCuts(
    [{ layer, groups: [group], cutterRadiusMm: 1, finishAllowanceMm: 0 }],
    [wall],
  );
}

afterEach(() => vi.restoreAllMocks());

it('measures repeated XY geometry once even when each pass has different Z values', () => {
  const closest = vi.spyOn(distance, 'closestSegmentPoints');
  const oneDepth = cuts([pass(-1)]);
  const checks = closest.mock.calls.length;
  expect(oneDepth).toHaveLength(1);
  expect(checks).toBeGreaterThan(0);
  closest.mockClear();

  expect(cuts([pass(-1), pass(-2), pass(-3)])).toEqual(oneDepth);
  expect(closest).toHaveBeenCalledTimes(checks);
});
