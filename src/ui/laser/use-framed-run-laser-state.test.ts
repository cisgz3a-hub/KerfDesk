import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { FramedRunPermit } from '../state/framed-run';
import type { LaserState } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { framedRunFieldsEqual } from './use-framed-run-laser-state';

function report(state: StatusReport['state'], x: number): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x, y: 0, z: 0 },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

function laser(patch: Partial<LaserState>): LaserState {
  return { ...(initialLaserState() as LaserState), ...patch };
}

describe('framedRunFieldsEqual', () => {
  it('ignores a head-only status poll while no Frame permit exists', () => {
    expect(
      framedRunFieldsEqual(
        laser({ statusReport: report('Run', 10) }),
        laser({ statusReport: report('Run', 11) }),
      ),
    ).toBe(true);
  });

  it('still re-renders when the controller state changes without a permit', () => {
    expect(
      framedRunFieldsEqual(
        laser({ statusReport: report('Run', 10) }),
        laser({ statusReport: report('Idle', 10) }),
      ),
    ).toBe(false);
  });

  it('compares the whole report while a permit is held', () => {
    const framedRun = {} as FramedRunPermit;
    expect(
      framedRunFieldsEqual(
        laser({ framedRun, statusReport: report('Idle', 10) }),
        laser({ framedRun, statusReport: report('Idle', 11) }),
      ),
    ).toBe(false);
  });
});
