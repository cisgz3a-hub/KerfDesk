import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../core/controllers/grbl';
import { createStreamer } from '../core/controllers/grbl/streamer';
import { resolvePreviewJobPlacement, type JobPlacementSettings } from './job-placement';
import { startMotionOperation } from './state/laser-motion-operation';
import { initialLaserState } from './state/laser-store-helpers';
import { selectPreviewJobPlacement } from './use-preview-job-placement';

type Source = Parameters<typeof selectPreviewJobPlacement>[1];

function report(
  state: StatusReport['state'],
  x: number,
  fields: Partial<Pick<StatusReport, 'wPos' | 'wco'>> = {},
): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x, y: 4, z: 0 },
    wPos: { x, y: 4, z: 0 },
    feed: 0,
    spindle: 0,
    wco: null,
    ...fields,
  };
}

const idle: Source = { ...initialLaserState(), statusReport: report('Idle', 0) };
const streaming = { ...createStreamer('G1 X1'), status: 'streaming' as const };

// Settled machine states, each differing from the one before in a field some
// resolver reads, so a field the memo failed to compare would surface as a stale
// placement on exactly that step.
const settledSequence: ReadonlyArray<Source> = [
  idle,
  { ...idle, statusReport: report('Idle', 25) },
  { ...idle, statusReport: report('Idle', 25) },
  { ...idle, statusReport: report('Idle', 25, { wPos: null }) },
  { ...idle, statusReport: report('Idle', 25, { wco: { x: 10, y: 0, z: 0 } }) },
  { ...idle, wcoCache: { x: 10, y: 5, z: 0 } },
  { ...idle, wcoCache: { x: 10, y: 5, z: 0 }, workOriginActive: true },
  { ...idle, workOriginActive: true },
  {
    ...idle,
    wcoCache: { x: 1, y: 1, z: 0 },
    controllerSettings: { homingEnabled: true, reportInches: true },
  },
  { ...idle, statusReport: null },
  idle,
];

const MODES = ['absolute', 'current-position', 'user-origin', 'verified-origin'] as const;

function machineOf(state: Source) {
  return {
    statusReport: state.statusReport,
    workOriginActive: state.workOriginActive,
    wcoCache: state.wcoCache,
    reportInches: state.controllerSettings?.reportInches === true,
  };
}

describe('selectPreviewJobPlacement', () => {
  it.each(MODES)('resolves %s exactly like resolvePreviewJobPlacement', (startFrom) => {
    const settings: JobPlacementSettings = { startFrom, anchor: 'center' };
    for (const state of settledSequence) {
      expect(selectPreviewJobPlacement(settings, state)).toEqual(
        resolvePreviewJobPlacement(settings, machineOf(state)),
      );
    }
  });

  it.each(MODES)('returns one %s placement object across polls that resolve alike', (startFrom) => {
    const settings: JobPlacementSettings = { startFrom, anchor: 'front-left' };
    const first = selectPreviewJobPlacement(settings, idle);
    for (let poll = 0; poll < 20; poll += 1) {
      expect(
        selectPreviewJobPlacement(settings, { ...idle, statusReport: report('Idle', 0) }),
      ).toBe(first);
    }
  });

  it('holds Current Position while a job moves the head, then follows the settled head', () => {
    const settings: JobPlacementSettings = { startFrom: 'current-position', anchor: 'center' };
    const before = selectPreviewJobPlacement(settings, idle);
    for (let x = 5; x <= 200; x += 5) {
      const moving = { ...idle, streamer: streaming, statusReport: report('Run', x) };
      expect(selectPreviewJobPlacement(settings, moving)).toBe(before);
    }
    // A Frame reports Idle between its legs while it still owns the head.
    const framing = {
      ...idle,
      motionOperation: startMotionOperation('frame'),
      statusReport: report('Idle', 90),
    };
    expect(selectPreviewJobPlacement(settings, framing)).toBe(before);

    const parked = { ...idle, statusReport: report('Idle', 60) };
    expect(selectPreviewJobPlacement(settings, parked)).toEqual(
      resolvePreviewJobPlacement(settings, machineOf(parked)),
    );
    expect(selectPreviewJobPlacement(settings, parked)).not.toEqual(before);
  });

  it('never holds a mode whose placement does not follow the head', () => {
    const settings: JobPlacementSettings = { startFrom: 'absolute', anchor: 'center' };
    selectPreviewJobPlacement(settings, idle);
    const running = {
      ...idle,
      streamer: streaming,
      statusReport: report('Run', 40, { wco: { x: 3, y: 0, z: 0 } }),
    };
    expect(selectPreviewJobPlacement(settings, running)).toEqual(
      resolvePreviewJobPlacement(settings, machineOf(running)),
    );
  });
});
