import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { estimateJobDuration } from '../job/estimate-duration';
import type { CncGroup, CncPass, Job } from '../job/job';
import { buildToolpath } from '../job/toolpath';
import { emitCncJobWithPassSpans } from '../output';
import { cncGroupMaximumDepthMm } from './cnc-group-maximum-depth';
import { cncPassCanEmit } from './cnc-pass-emission';

const EMISSIONLESS_PASSES = [
  {
    name: 'collapsed contour',
    pass: {
      kind: 'contour',
      zMm: -2,
      polyline: [
        { x: 247.01767, y: 20 },
        { x: 247.01768, y: 20 },
      ],
      closed: false,
    },
  },
  {
    name: 'one-point path3d',
    pass: { kind: 'path3d', points: [{ x: 0, y: 0, z: -2 }], closed: false },
  },
  {
    name: 'zero-radius arc',
    pass: {
      kind: 'arc',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: false,
      zMm: -2,
      closed: false,
    },
  },
] as const satisfies ReadonlyArray<{ readonly name: string; readonly pass: CncPass }>;

function group(pass: CncPass): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'emission-parity',
    color: '#000000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 600,
    plungeMmPerMin: 120,
    spindleRpm: 12_000,
    spindleSpinupSec: 0,
    safeZMm: 5,
    passes: [pass],
  };
}

describe('CNC pass emission eligibility parity', () => {
  it.each(EMISSIONLESS_PASSES)(
    'excludes an emissionless $name from runtime motion and depth consumers',
    ({ pass }) => {
      const cncGroup = group(pass);
      const job: Job = { groups: [cncGroup] };

      expect(cncPassCanEmit(pass)).toBe(false);
      expect(emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE).spans).toEqual([]);
      expect(buildToolpath(job).steps).toEqual([]);
      expect(cncGroupMaximumDepthMm(cncGroup)).toBe(0);
      expect(estimateJobDuration(job, DEFAULT_DEVICE_PROFILE).totalSeconds).toBe(0);
    },
  );
});
