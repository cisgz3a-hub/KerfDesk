// Regression (rolling audit v9 R8-P2-2, ADR-684 Amendment 1): the "may hold a
// paused move" warning was recomputed from the position on every read, and a
// Frame returns the head to where it started, so the warning was still up
// after the very Frame that ran the tail. Following its advice to reset then
// dropped that Frame's permit. A dispatched Frame now retires it for good.
// Real store, real Frame on the grblHAL simulator with the A1 Pro's `$$`; the
// tail is recorded in the store as the Resume would record it. No hardware.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { currentHeldResumeTail } from '../state/held-resume-tail';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { clearFrameExpiryNote } from './frame-expiry-note';
import { connectAtHead, HEAD } from './frame-after-origin-write.test-support';
import { runFrameNow } from './use-frame-action';
import type * as OutputPreparationWorker from './output-preparation-worker-client';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputPreparationWorker>()),
  prepareStartOutputOffThread: async (
    request: Parameters<typeof prepareOutputRequestForTest>[0],
  ) => {
    const response = await prepareOutputRequestForTest(request);
    if (response.kind !== 'start') throw new Error('Expected start preparation');
    return response.result;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  clearFrameExpiryNote();
});
afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

describe('the held-tail warning after a Frame (R8-P2-2)', () => {
  it('retires for good once a Frame has run, and the Frame keeps its permit', async () => {
    const { sim } = await connectAtHead('falcon-a1-pro', 'every-report', {
      startFrom: 'current-position',
      anchor: 'front-left',
    });
    const state = useLaserStore.getState();
    useLaserStore.setState({
      heldResumeTail: {
        sessionEpoch: state.controllerSessionEpoch,
        machinePosition: { ...HEAD, z: 0 },
        streamerEpoch: state.streamerEpoch,
      },
    });
    expect(currentHeldResumeTail(useLaserStore.getState())).not.toBeNull();

    const framing = runFrameNow();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await framing).toBe(true);
    // The Frame came back to the point where Resume confirmed.
    expect(sim.state().mpos.x).toBeCloseTo(HEAD.x, 3);
    expect(sim.state().mpos.y).toBeCloseTo(HEAD.y, 3);
    expect(useLaserStore.getState().heldResumeTail).toBeNull();
    expect(currentHeldResumeTail(useLaserStore.getState())).toBeNull();
    // Nothing asks for a reset, so the permit stands.
    expect(useLaserStore.getState().framedRun).not.toBeNull();
    // Later idle reports at the same point do not bring it back.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(currentHeldResumeTail(useLaserStore.getState())).toBeNull();
  });
});
