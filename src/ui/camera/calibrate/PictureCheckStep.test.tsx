import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../../../core/camera';
import { mountControl } from '../../image-editor/control-audit-test-support';
import { useCameraStore } from '../../state/camera-store';
import { resetStore } from '../../state/test-helpers';
import { captureSourceFrame, type ActiveCameraSource } from '../frame-source';
import type * as FrameSource from '../frame-source';
import { PictureCheckStep, PICTURE_CHECK_INTERVAL_MS } from './PictureCheckStep';

vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));
vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: vi.fn(),
}));

const source: ActiveCameraSource = {
  kind: 'machine-jpeg',
  frameUrl: '/first',
  cameraUrl: 'http://camera/first',
};
const frame: RgbaImage = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(128) };
function deferredFrame() {
  let resolve!: (frame: RgbaImage | null) => void;
  const promise = new Promise<RgbaImage | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  vi.mocked(captureSourceFrame).mockReset();
  useCameraStore.setState({ sourceState: { kind: 'live', source } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('picture measurement capture ownership', () => {
  it('keeps only one slow capture in flight and resumes after it settles', async () => {
    const pending = deferredFrame();
    vi.mocked(captureSourceFrame).mockReturnValueOnce(pending.promise).mockResolvedValue(frame);
    const host = await mountControl(<PictureCheckStep />);
    await act(async () => {
      vi.advanceTimersByTime(PICTURE_CHECK_INTERVAL_MS * 4);
    });
    expect(captureSourceFrame).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(frame);
    });
    expect(host.textContent).toContain('2 × 2 picture');
    await act(async () => {
      vi.advanceTimersByTime(PICTURE_CHECK_INTERVAL_MS);
    });
    expect(captureSourceFrame).toHaveBeenCalledTimes(2);
  });

  it('suppresses an old source result and waits for it before capturing the replacement', async () => {
    const pending = deferredFrame();
    vi.mocked(captureSourceFrame).mockReturnValueOnce(pending.promise).mockResolvedValue(frame);
    const host = await mountControl(<PictureCheckStep />);
    const replacement: ActiveCameraSource = {
      ...source,
      frameUrl: '/next',
      cameraUrl: 'http://camera/next',
    };
    await act(async () => {
      useCameraStore.setState({ sourceState: { kind: 'live', source: replacement } });
    });
    expect(captureSourceFrame).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ ...frame, width: 1, data: frame.data.slice(0, 8) });
    });
    expect(host.textContent).not.toContain('1 × 2 picture');
    await act(async () => {
      vi.advanceTimersByTime(PICTURE_CHECK_INTERVAL_MS);
    });
    expect(captureSourceFrame).toHaveBeenLastCalledWith(replacement);
    expect(host.textContent).toContain('2 × 2 picture');
  });

  it('recovers after a rejected capture without overlapping retries', async () => {
    vi.mocked(captureSourceFrame)
      .mockRejectedValueOnce(new Error('camera unavailable'))
      .mockResolvedValue(frame);
    const host = await mountControl(<PictureCheckStep />);
    await act(async () => {
      vi.advanceTimersByTime(PICTURE_CHECK_INTERVAL_MS);
    });
    expect(captureSourceFrame).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('2 × 2 picture');
  });
});
