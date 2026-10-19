import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { buildMotionManifest } from '../../../core/job/motion-manifest';
import { fingerprintGcode } from '../../../core/recovery';
import type { CanvasMotionPlan } from '../../state/canvas-motion-plan';
import { burnRegion, burnRouteMasks } from './job-burn-route';

const GCODE = 'G21\nG90\nM4 S0\nG0 X0 Y0\nG1 X30 S800\nG1 Y20\nG1 X0\nM5';
const BED_FRAME = { kind: 'machine', workOffsetMm: { x: 120, y: 80, z: 0 } } as const;

function plan(coordinateFrame: CanvasMotionPlan['coordinateFrame']): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(GCODE, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(GCODE),
    retentionKey: 'job-burn-route',
    machineKind: 'laser',
    device: { ...DEFAULT_DEVICE_PROFILE, bedWidth: 400, bedHeight: 400, origin: 'rear-left' },
    coordinateFrame,
    framePerimeter: [],
    jobStart: null,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

// ADR-636: a User Origin job is drawn over its artwork, far from where its
// origin sits on the bed. The camera must still look where it burns.
describe('job burn route on the bed', () => {
  it('watches where a job drawn over its artwork really burns', () => {
    const onBed = plan(BED_FRAME);
    const onArtwork = plan({
      kind: 'relative',
      jobOriginOffset: { x: -15, y: -25 },
      bed: BED_FRAME,
    });
    const region = burnRegion(onBed);
    expect(region).not.toBeNull();
    expect(burnRegion(onArtwork)).toEqual(region);
    if (region === null) return;
    expect(burnRouteMasks(onArtwork, region, 2, 0)).toEqual(burnRouteMasks(onBed, region, 2, 0));
  });

  it('keeps an artwork-relative job without a bed position where it is drawn', () => {
    const relative = plan({ kind: 'relative', jobOriginOffset: { x: 0, y: 0 } });
    const atZero = plan({ kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } });
    expect(burnRegion(relative)).toEqual(burnRegion(atZero));
  });
});
