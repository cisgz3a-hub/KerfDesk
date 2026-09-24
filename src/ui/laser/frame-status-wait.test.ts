import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { waitForControllerStatus } from './frame-status-wait';

const idle: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 10, y: 20, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};

const hasOffset = (laser: ReturnType<typeof useLaserStore.getState>): boolean =>
  laser.wcoCache !== null;

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idle,
    wcoCache: null,
    requestControllerStatus: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  vi.useRealTimers();
  useLaserStore.setState(initialLaserState());
});

describe('waitForControllerStatus', () => {
  it('returns at once, without querying, when the evidence is already there', async () => {
    useLaserStore.setState({ wcoCache: { x: 1, y: 2, z: 0 } });
    await expect(waitForControllerStatus(hasOffset)).resolves.toBe(true);
    expect(useLaserStore.getState().requestControllerStatus).not.toHaveBeenCalled();
  });

  it('bursts status queries until the report carries the missing field', async () => {
    let queries = 0;
    useLaserStore.setState({
      requestControllerStatus: vi.fn(async () => {
        queries += 1;
        // GRBL puts WCO in one Idle report out of ten.
        if (queries === 10) useLaserStore.setState({ wcoCache: { x: 1, y: 2, z: 0 } });
      }),
    });
    const waited = waitForControllerStatus(hasOffset);
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(waited).resolves.toBe(true);
    expect(queries).toBe(10);
  });

  it('gives up after the bounded wait so the Frame can report its refusal', async () => {
    const waited = waitForControllerStatus(hasOffset);
    await vi.advanceTimersByTimeAsync(3_100);
    await expect(waited).resolves.toBe(false);
    const queries = vi.mocked(useLaserStore.getState().requestControllerStatus).mock.calls.length;
    // One query per 100 ms interval, never a flood.
    expect(queries).toBeGreaterThanOrEqual(25);
    expect(queries).toBeLessThanOrEqual(32);
  });

  it('stops when the controller session changes under it', async () => {
    const waited = waitForControllerStatus(hasOffset);
    await vi.advanceTimersByTimeAsync(200);
    useLaserStore.setState((state) => ({
      controllerSessionEpoch: state.controllerSessionEpoch + 1,
    }));
    await vi.advanceTimersByTimeAsync(50);
    await expect(waited).resolves.toBe(false);
  });

  it('does not wait on a controller that cannot answer realtime status queries', async () => {
    useLaserStore.setState((state) => ({
      capabilities: { ...state.capabilities, statusQuery: 'queued-poll' },
    }));
    await expect(waitForControllerStatus(hasOffset)).resolves.toBe(false);
    expect(useLaserStore.getState().requestControllerStatus).not.toHaveBeenCalled();
  });

  it('does not wait while disconnected', async () => {
    useLaserStore.setState({ connection: { kind: 'disconnected' } });
    await expect(waitForControllerStatus(hasOffset)).resolves.toBe(false);
    expect(useLaserStore.getState().requestControllerStatus).not.toHaveBeenCalled();
  });
});
