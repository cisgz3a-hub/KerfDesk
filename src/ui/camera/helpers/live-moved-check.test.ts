// Camera audit v2 K2-P1-1 (ADR-663 Amendment 8): a live picture on the
// canvas was checked for a moved camera only once, three seconds after the
// camera started; a knock afterwards stayed "steady". It is now checked again
// every LIVE_MOVED_CHECK_MS while it is shown.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { checkLivePictureForMoves, LIVE_MOVED_CHECK_MS } from './live-moved-check';

const source = {
  kind: 'machine-jpeg' as const,
  cameraUrl: 'http://camera.invalid/frame',
  frameUrl: 'http://bridge.invalid/frame',
};
const initialCamera = useCameraStore.getState();
const still = { width: 2, height: 2, data: new Uint8ClampedArray(16) };

beforeEach(() => {
  vi.useFakeTimers();
  useCameraStore.setState({
    ...initialCamera,
    sourceState: { kind: 'live', source },
    overlayVisible: true,
    overlayStill: null,
  });
  useLaserStore.setState({ streamer: null });
});

afterEach(() => {
  vi.useRealTimers();
  useCameraStore.setState(initialCamera);
});

describe('checkLivePictureForMoves', () => {
  it('checks the live picture on the canvas again and again', async () => {
    const check = vi.fn(async () => undefined);
    const stop = checkLivePictureForMoves({ check });
    await vi.advanceTimersByTimeAsync(LIVE_MOVED_CHECK_MS * 3);
    stop();
    expect(check).toHaveBeenCalledTimes(3);
    expect(check).toHaveBeenCalledWith(source);
  });

  it('leaves a held picture, a hidden picture and a running job alone', async () => {
    const check = vi.fn(async () => undefined);
    const stop = checkLivePictureForMoves({ check });
    useCameraStore.setState({ overlayStill: still });
    await vi.advanceTimersByTimeAsync(LIVE_MOVED_CHECK_MS);
    useCameraStore.setState({ overlayStill: null, overlayVisible: false });
    await vi.advanceTimersByTimeAsync(LIVE_MOVED_CHECK_MS);
    useCameraStore.setState({ overlayVisible: true });
    useLaserStore.setState({ streamer: { status: 'streaming' } as never });
    await vi.advanceTimersByTimeAsync(LIVE_MOVED_CHECK_MS);
    expect(check).not.toHaveBeenCalled();
    // The first check after the job runs again.
    useLaserStore.setState({ streamer: null });
    await vi.advanceTimersByTimeAsync(LIVE_MOVED_CHECK_MS);
    stop();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('never runs two checks at once', async () => {
    let finish: () => void = () => undefined;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = checkLivePictureForMoves({ check });
    await vi.advanceTimersByTimeAsync(LIVE_MOVED_CHECK_MS * 3);
    expect(check).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(LIVE_MOVED_CHECK_MS);
    stop();
    expect(check).toHaveBeenCalledTimes(2);
  });
});
