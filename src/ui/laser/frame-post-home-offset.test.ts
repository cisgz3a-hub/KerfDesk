import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { waitForAbsoluteFrameOffset } from './frame-position-readiness';

const originalRequest = useLaserStore.getState().requestControllerStatus;
const absolute = { startFrom: 'absolute', anchor: 'front-left' } as const;

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusSequence: 8,
    homingState: 'confirmed',
    workOriginActive: true,
    workOriginSource: 'unknown',
    wcoCache: null,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: null,
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
  useLaserStore.setState({ ...initialLaserState(), requestControllerStatus: originalRequest });
});

describe('Frame after Home waits for the observed work offset', () => {
  it('also waits after Home when no previous custom origin was recorded', async () => {
    useLaserStore.setState({ workOriginActive: false, workOriginSource: 'none' });
    let settled = false;
    const pending = waitForAbsoluteFrameOffset(absolute).then((ready) => {
      settled = true;
      return ready;
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(settled).toBe(false);
    expect(useLaserStore.getState().requestControllerStatus).toHaveBeenCalledTimes(3);
    useLaserStore.setState({
      statusSequence: 9,
      wcoCache: { x: 0, y: 0, z: 0 },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        wco: { x: 0, y: 0, z: 0 },
        feed: 0,
        spindle: 0,
      },
    });
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBe(true);
  });
  it.each([0, 200.398])(
    'waits through incomplete reports and retains reported X offset %s',
    async (x) => {
      let settled = false;
      const pending = waitForAbsoluteFrameOffset(absolute).then((ready) => {
        settled = true;
        return ready;
      });
      expect(useLaserStore.getState().requestControllerStatus).toHaveBeenCalledOnce();
      useLaserStore.setState({
        statusSequence: 9,
        statusReport: {
          state: 'Idle',
          subState: null,
          mPos: null,
          wPos: { x: 0, y: 0, z: 0 },
          wco: null,
          feed: 0,
          spindle: 0,
        },
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(false);
      useLaserStore.setState({ statusSequence: 10, wcoCache: { x, y: 170.323, z: 0 } });
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toBe(true);
      expect(useLaserStore.getState().wcoCache).toEqual({ x, y: 170.323, z: 0 });
    },
  );

  it('does not manufacture a zero offset when readback never arrives', async () => {
    const pending = waitForAbsoluteFrameOffset(absolute);
    await vi.advanceTimersByTimeAsync(3100);
    await expect(pending).resolves.toBe(false);
    expect(useLaserStore.getState().wcoCache).toBeNull();
  });

  it('abandons the old wait when the controller session is replaced', async () => {
    const pending = waitForAbsoluteFrameOffset(absolute);
    useLaserStore.setState((s) => ({ controllerSessionEpoch: s.controllerSessionEpoch + 1 }));
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBe(false);
  });

  it('uses already observed offsets immediately without another status query', async () => {
    useLaserStore.setState({ wcoCache: { x: 200.398, y: 170.323, z: 0 } });
    await expect(waitForAbsoluteFrameOffset(absolute)).resolves.toBe(true);
    expect(useLaserStore.getState().requestControllerStatus).not.toHaveBeenCalled();
  });
});
