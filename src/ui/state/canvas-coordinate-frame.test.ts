import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job, JobOriginPlacement } from '../../core/job';
import { createProject } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { artworkToBedShift } from './canvas-coordinate-frame';
import { buildCanvasMotionPlan } from './canvas-motion-plan';
import { stockNativeEvidence } from './native-bed-frame.test-support';

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'red',
      color: '#ff0000',
      power: 50,
      speed: 1000,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 20 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function prepared(jobOriginOffset = { x: 0, y: 0 }) {
  const project = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'grbl-v1.1',
    origin: 'rear-left',
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
  });
  return { ok: true, project, job: JOB, jobOriginOffset } satisfies Extract<
    PreparedOutput,
    { readonly ok: true }
  >;
}

const homedMachine = {
  statusReport: {
    state: 'Idle' as const,
    subState: null,
    mPos: { x: 2, y: 1, z: 0 },
    wPos: { x: 2, y: 1, z: 0 },
    feed: 0,
    spindle: 0,
    wco: null,
  },
  alarmCode: null,
  hasActiveStreamer: false,
  trustedPositionEpoch: 4,
  ...stockNativeEvidence(prepared().project.device, true),
  workOriginActive: true,
  wcoCache: { x: 5, y: 5, z: 0 },
  homingState: 'confirmed' as const,
};

const BED_FRAME = {
  kind: 'machine',
  workOffsetMm: { x: 5, y: 5, z: 0 },
  nativeToBedOffsetMm: { x: 0, y: 0 },
} as const;

function plan(jobOrigin: JobOriginPlacement, jobOriginOffset = { x: 0, y: 0 }) {
  return buildCanvasMotionPlan({
    gcode: 'G21\nG90\nM3 S0\nG0 X0 Y0\nG1 X20 S500',
    prepared: prepared(jobOriginOffset),
    machine: homedMachine,
    statusQuery: 'realtime-report',
    jobOrigin,
  });
}

describe('canvas coordinate frame on a homed machine', () => {
  it('keeps an Absolute job in the machine frame, where the canvas is the bed', () => {
    const absolute = plan({ startFrom: 'absolute', anchor: 'front-left' });
    expect(absolute.coordinateFrame).toEqual(BED_FRAME);
    expect(artworkToBedShift(absolute)).toEqual({ x: 0, y: 0 });
  });

  // ADR-642: a User Origin job was drawn where its origin sits on the bed, a
  // second copy beside the artwork it burns.
  it.each<JobOriginPlacement>([
    { startFrom: 'user-origin', anchor: 'front-left' },
    { startFrom: 'current-position', anchor: 'front-left', currentPosition: { x: 0, y: 0 } },
  ])('draws a $startFrom job over its artwork and keeps its bed frame', (jobOrigin) => {
    const onArtwork = plan(jobOrigin, { x: -10, y: -20 });
    expect(onArtwork.coordinateFrame).toEqual({
      kind: 'relative',
      jobOriginOffset: { x: -10, y: -20 },
      bed: BED_FRAME,
    });
    expect(onArtwork.jobStart).toEqual({ x: 10, y: 20 });
    // Work zero burns at bed (5, 5) and is drawn at the artwork's corner (10, 20).
    expect(artworkToBedShift(onArtwork)).toEqual({ x: -5, y: -15 });
  });
});
