// The Frame's question for a not-yet-reported work offset (ADR-375) is only
// asked when an answer could change the placement and could arrive: a WCO-
// reporting controller, no known offset or custom origin, a start mode that
// reads the offset, and reports the store keeps. Otherwise Frame goes on at
// once, exactly as before.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, smoothiewareDriver } from '../../core/controllers';
import type { JobPlacementSettings } from '../job-placement';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { waitForUnreportedFrameWorkOffset } from './frame-position-readiness';

const originalRequest = useLaserStore.getState().requestControllerStatus;
const originalCapabilities = useLaserStore.getState().capabilities;
const absolute: JobPlacementSettings = { startFrom: 'absolute', anchor: 'front-left' };

function requests(): number {
  return vi.mocked(useLaserStore.getState().requestControllerStatus).mock.calls.length;
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState({
    ...initialLaserState(),
    capabilities: grblDriver.capabilities,
    connection: { kind: 'connected' },
    statusSequence: 4,
    homingState: 'unknown',
    workOriginActive: false,
    workOriginSource: 'none',
    wcoCache: null,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 10, y: 20, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    requestControllerStatus: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  vi.useRealTimers();
  useLaserStore.setState({
    ...initialLaserState(),
    capabilities: originalCapabilities,
    requestControllerStatus: originalRequest,
  });
});

describe('waitForUnreportedFrameWorkOffset', () => {
  it('asks until the offset arrives', async () => {
    let settled = false;
    const pending = waitForUnreportedFrameWorkOffset(absolute).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(settled).toBe(false);
    expect(requests()).toBe(3);

    useLaserStore.setState({ statusSequence: 5, wcoCache: { x: 0, y: 0, z: 0 } });
    await vi.advanceTimersByTimeAsync(25);
    await pending;
    expect(settled).toBe(true);
  });

  it('gives up after the bounded burst without refusing', async () => {
    const pending = waitForUnreportedFrameWorkOffset(absolute);
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(pending).resolves.toBeUndefined();
    expect(requests()).toBe(31);
    expect(useLaserStore.getState().wcoCache).toBeNull();
  });

  it('ends without an offset when the controller session is replaced', async () => {
    const pending = waitForUnreportedFrameWorkOffset(absolute);
    useLaserStore.setState((s) => ({ controllerSessionEpoch: s.controllerSessionEpoch + 1 }));
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBeUndefined();
    expect(useLaserStore.getState().wcoCache).toBeNull();
  });

  it.each([
    ['the offset is already known', { wcoCache: { x: 150, y: 100, z: 0 } }, absolute],
    // Absolute then refuses on its own rather than assuming zero.
    ['a custom origin is set', { workOriginActive: true, workOriginSource: 'g92' }, absolute],
    ['the placement is origin-relative', {}, { startFrom: 'user-origin', anchor: 'front-left' }],
    // The store drops WCO with the positions, so no report could end the wait.
    ['reported positions are being discarded', { positionEvidenceSuppressed: true }, absolute],
    // Smoothieware's offset is MPos minus WPos, in every report.
    [
      'the controller reports no WCO field',
      { capabilities: smoothiewareDriver.capabilities },
      absolute,
    ],
  ] as const)('goes on at once when %s', async (_case, state, placement) => {
    useLaserStore.setState(state);
    await waitForUnreportedFrameWorkOffset(placement);
    expect(requests()).toBe(0);
  });

  it('goes on at once for Current Position placed from both reported positions', async () => {
    useLaserStore.setState((s) => ({
      statusReport: s.statusReport && { ...s.statusReport, wPos: { x: 10, y: 20, z: 0 } },
    }));
    await waitForUnreportedFrameWorkOffset({ startFrom: 'current-position', anchor: 'center' });
    expect(requests()).toBe(0);
  });
});
