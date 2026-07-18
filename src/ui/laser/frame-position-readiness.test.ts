import { describe, expect, it } from 'vitest';
import { initialLaserState } from '../state/laser-store-helpers';
import { hasFreshIdleFramePosition } from './frame-position-readiness';

function laserState() {
  return {
    ...initialLaserState(),
    statusSequence: 8,
    statusReport: {
      state: 'Idle' as const,
      subState: null,
      mPos: { x: 10, y: 20, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
  };
}

describe('Frame position readiness', () => {
  it('accepts a newer complete Idle position sample', () => {
    expect(hasFreshIdleFramePosition(laserState(), 7)).toBe(true);
  });

  it('rejects the stale sample captured before setup changed coordinates', () => {
    expect(hasFreshIdleFramePosition(laserState(), 8)).toBe(false);
  });

  it('rejects a newer report without a usable work position', () => {
    const state = laserState();
    expect(
      hasFreshIdleFramePosition(
        { ...state, statusReport: { ...state.statusReport, mPos: null } },
        7,
      ),
    ).toBe(false);
  });
});
