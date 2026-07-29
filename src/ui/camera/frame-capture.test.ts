import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../../core/camera';
import { captureStreamFrame, STREAM_FRAME_TIMEOUT_MS } from './frame-capture';

const FRAME_WIDTH_PX = 1;
const FRAME_HEIGHT_PX = 1;
const OPAQUE_PIXEL = new Uint8ClampedArray([10, 20, 30, 255]);
// jsdom has no MediaStream implementation; capture treats this as an opaque source object.
const TEST_STREAM = {} as MediaStream;

type StartedCapture = {
  readonly capture: Promise<RgbaImage | null>;
  readonly video: HTMLVideoElement;
};

function startCapture(): StartedCapture {
  const createElement = vi.spyOn(document, 'createElement');
  const capture = captureStreamFrame(TEST_STREAM);
  const video = createElement.mock.results[0]?.value;
  if (!(video instanceof HTMLVideoElement)) throw new Error('capture did not create a video');
  return { capture, video };
}

function pendingPromise<T>(): Promise<T> {
  return new Promise(() => undefined);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('captureStreamFrame', () => {
  it('resolves null within a bounded time when video playback never settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(pendingPromise());
    const { capture, video } = startCapture();
    const outcome = Promise.race([
      capture.then((value) => ({ kind: 'settled' as const, value })),
      new Promise<{ readonly kind: 'deadline' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'deadline' }), STREAM_FRAME_TIMEOUT_MS + 1),
      ),
    ]);

    await vi.advanceTimersByTimeAsync(STREAM_FRAME_TIMEOUT_MS + 1);

    expect(await outcome).toEqual({ kind: 'settled', value: null });
    expect(video.srcObject).toBeNull();
    expect(video.onloadeddata).toBeNull();
    expect(video.onerror).toBeNull();
  });

  it('cleans up after a media error before the timeout', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(pendingPromise());
    const { capture, video } = startCapture();

    video.onerror?.(new Event('error'));

    await expect(capture).resolves.toBeNull();
    expect(video.srcObject).toBeNull();
    expect(video.onloadeddata).toBeNull();
    expect(video.onerror).toBeNull();
  });

  it('cleans up after asynchronous video playback rejection', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('play failed'));
    const { capture, video } = startCapture();

    await expect(capture).resolves.toBeNull();
    expect(video.srcObject).toBeNull();
    expect(video.onloadeddata).toBeNull();
    expect(video.onerror).toBeNull();
  });

  it('turns a frame read exception into a cleaned-up null outcome', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(pendingPromise());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('frame read failed');
    });
    const { capture, video } = startCapture();
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: FRAME_WIDTH_PX },
      videoHeight: { configurable: true, value: FRAME_HEIGHT_PX },
    });

    expect(() => video.onloadeddata?.(new Event('loadeddata'))).not.toThrow();
    await expect(capture).resolves.toBeNull();
    expect(video.srcObject).toBeNull();
    expect(video.onloadeddata).toBeNull();
    expect(video.onerror).toBeNull();
  });

  it('turns a synchronous play exception into a cleaned-up null outcome', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
      throw new Error('play failed');
    });
    const { capture, video } = startCapture();

    await expect(capture).resolves.toBeNull();
    expect(video.srcObject).toBeNull();
    expect(video.onloadeddata).toBeNull();
    expect(video.onerror).toBeNull();
  });

  it('returns the captured frame and clears lifecycle handlers', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(pendingPromise());
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: OPAQUE_PIXEL,
        width: FRAME_WIDTH_PX,
        height: FRAME_HEIGHT_PX,
      })),
    };
    // The fixture implements exactly the two canvas methods this capture path calls.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const { capture, video } = startCapture();
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: FRAME_WIDTH_PX },
      videoHeight: { configurable: true, value: FRAME_HEIGHT_PX },
    });

    video.onloadeddata?.(new Event('loadeddata'));

    await expect(capture).resolves.toEqual({
      data: OPAQUE_PIXEL,
      width: FRAME_WIDTH_PX,
      height: FRAME_HEIGHT_PX,
    });
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(video.onloadeddata).toBeNull();
    expect(video.onerror).toBeNull();
  });
});
