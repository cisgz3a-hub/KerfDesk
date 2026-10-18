// The live overlay redraws once per picture the camera element presents.
// A camera stream's currentTime is a clock that advances on every animation
// frame (W3C Media Capture and Streams, section 6), so keying on it redrew the
// whole corrected bed at the display's refresh rate instead of the camera's
// frame rate: 59 draws a second for a 15 fps camera on a 60 Hz screen.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchLiveFrames } from './use-bed-overlay-drawing';

type FrameCallback = () => void;

function fakeAnimationFrames(): { readonly step: () => void; readonly pending: () => number } {
  let queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.set(next, callback);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => queue.delete(handle));
  return {
    step: () => {
      const due = queue;
      queue = new Map();
      for (const callback of due.values()) callback(0);
    },
    pending: () => queue.size,
  };
}

function cameraVideo(withFrameCallback: boolean): {
  readonly video: HTMLVideoElement;
  readonly present: () => void;
  readonly pending: () => number;
  readonly clock: { now: number };
} {
  const video = document.createElement('video');
  const clock = { now: 10 };
  Object.defineProperty(video, 'currentTime', { get: () => clock.now });
  Object.defineProperty(video, 'videoWidth', { get: () => 1280 });
  Object.defineProperty(video, 'videoHeight', { get: () => 720 });
  let callbacks = new Map<number, FrameCallback>();
  let next = 1;
  if (withFrameCallback) {
    Object.defineProperty(video, 'requestVideoFrameCallback', {
      value: (callback: FrameCallback) => {
        callbacks.set(next, callback);
        return next++;
      },
    });
    Object.defineProperty(video, 'cancelVideoFrameCallback', {
      value: (handle: number) => callbacks.delete(handle),
    });
  }
  return {
    video,
    present: () => {
      const due = callbacks;
      callbacks = new Map();
      for (const callback of due.values()) callback();
    },
    pending: () => callbacks.size,
    clock,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('watchLiveFrames', () => {
  it('redraws a camera video once per presented frame, not per animation frame', () => {
    const animation = fakeAnimationFrames();
    const camera = cameraVideo(true);
    const redraw = vi.fn();
    watchLiveFrames(camera.video, false, { lost: false }, redraw);

    for (let i = 0; i < 4; i += 1) {
      camera.clock.now += 1 / 60;
      animation.step();
    }
    expect(redraw).not.toHaveBeenCalled();

    camera.present();
    expect(redraw).toHaveBeenCalledTimes(1);
    camera.present();
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  it('skips the draw while the context is lost and draws the next frame after', () => {
    fakeAnimationFrames();
    const camera = cameraVideo(true);
    const renderer = { lost: true };
    const redraw = vi.fn();
    watchLiveFrames(camera.video, false, renderer, redraw);

    camera.present();
    expect(redraw).not.toHaveBeenCalled();
    renderer.lost = false;
    camera.present();
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('stops listening when disposed', () => {
    fakeAnimationFrames();
    const camera = cameraVideo(true);
    const redraw = vi.fn();
    const dispose = watchLiveFrames(camera.video, false, { lost: false }, redraw);
    expect(camera.pending()).toBe(1);

    dispose();
    expect(camera.pending()).toBe(0);
    camera.present();
    expect(redraw).not.toHaveBeenCalled();
  });

  it('falls back to animation frames where a video has no frame callback', () => {
    const animation = fakeAnimationFrames();
    const camera = cameraVideo(false);
    const redraw = vi.fn();
    const dispose = watchLiveFrames(camera.video, false, { lost: false }, redraw);

    animation.step();
    expect(redraw).toHaveBeenCalledTimes(1);
    animation.step();
    expect(redraw).toHaveBeenCalledTimes(1);
    camera.clock.now += 1 / 60;
    animation.step();
    expect(redraw).toHaveBeenCalledTimes(2);

    dispose();
    expect(animation.pending()).toBe(0);
  });
});
