import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { buildMotionManifest } from '../../../core/job/motion-manifest';
import { fingerprintGcode } from '../../../core/recovery';
import type { CanvasMotionPlan } from '../../state/canvas-motion-plan';
import { burnCheckBlocker, UNKNOWN_BED_POSITION_BURN_CHECK } from './burn-check-run';
import { burnRegion, burnRouteMasks, planPlacesOnBed } from './job-burn-route';
import type { WatchCamera } from './job-watch-camera';

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

// ADR-642: a User Origin job is drawn over its artwork, far from where its
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

  // Rolling audit 12-P2-4: a no-homing machine (or Verified Origin, or not
  // homed) keeps an artwork-relative frame with no bed (ADR-642 §3), labelled
  // "bed position unverified". Its artwork is not where it burns, so the watch
  // does not grade that patch of bed; it says why (ADR-490 §4).
  it('does not place a job whose bed position is unknown, and the burn check says why', () => {
    const unknown = plan({ kind: 'relative', jobOriginOffset: { x: -200, y: -230 } });
    expect(planPlacesOnBed(unknown)).toBe(false);
    expect(burnCheckBlocker(unknown, fixedCamera)).toBe(UNKNOWN_BED_POSITION_BURN_CHECK);
    for (const known of [
      plan(BED_FRAME),
      plan({ kind: 'relative', jobOriginOffset: { x: -15, y: -25 }, bed: BED_FRAME }),
    ]) {
      expect(planPlacesOnBed(known)).toBe(true);
      expect(burnCheckBlocker(known, fixedCamera)).toBeNull();
    }
  });
});

const fixedCamera = {
  source: { kind: 'usb' },
  fixedModel: {},
  surfaceHeightMm: 0,
  heightAreas: [],
} as unknown as WatchCamera;
