// The live overlay redraws only when the camera element shows a new picture.
// A camera stream's currentTime is a clock that advances on every animation
// frame (W3C Media Capture and Streams, section 6), so keying on it redrew the
// whole corrected bed at the display's refresh rate instead of the camera's
// frame rate: 4x the work for a 15 fps camera on a 60 Hz screen.

import { describe, expect, it } from 'vitest';
import { liveFrameKey } from './use-bed-overlay-drawing';

function cameraVideo(state: {
  currentTime: number;
  totalVideoFrames?: number;
  width?: number;
  height?: number;
}): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'currentTime', { get: () => state.currentTime });
  Object.defineProperty(video, 'videoWidth', { get: () => state.width ?? 1280 });
  Object.defineProperty(video, 'videoHeight', { get: () => state.height ?? 720 });
  if (state.totalVideoFrames !== undefined) {
    Object.defineProperty(video, 'getVideoPlaybackQuality', {
      value: () => ({ totalVideoFrames: state.totalVideoFrames, droppedVideoFrames: 0 }),
    });
  }
  return video;
}

describe('liveFrameKey', () => {
  it('keeps a camera video key while its clock runs but no new frame has arrived', () => {
    const state = { currentTime: 10.0, totalVideoFrames: 150 };
    const video = cameraVideo(state);
    const first = liveFrameKey(video, false);
    state.currentTime = 10.016;
    expect(liveFrameKey(video, false)).toBe(first);
    state.currentTime = 10.033;
    expect(liveFrameKey(video, false)).toBe(first);
  });

  it('changes the key when the camera delivers a new frame', () => {
    const state = { currentTime: 10.0, totalVideoFrames: 150 };
    const video = cameraVideo(state);
    const first = liveFrameKey(video, false);
    state.totalVideoFrames = 151;
    expect(liveFrameKey(video, false)).not.toBe(first);
  });

  it('changes the key when the camera changes resolution', () => {
    const state = { currentTime: 10.0, totalVideoFrames: 150, width: 1280, height: 720 };
    const video = cameraVideo(state);
    const first = liveFrameKey(video, false);
    state.width = 640;
    state.height = 360;
    expect(liveFrameKey(video, false)).not.toBe(first);
  });

  it('falls back to the clock where the browser counts no frames', () => {
    const counted = { currentTime: 10.0, totalVideoFrames: 0 };
    const zeroCount = cameraVideo(counted);
    const before = liveFrameKey(zeroCount, false);
    counted.currentTime = 10.1;
    expect(liveFrameKey(zeroCount, false)).not.toBe(before);

    const clockOnly = { currentTime: 10.0 };
    const noQuality = cameraVideo(clockOnly);
    const start = liveFrameKey(noQuality, false);
    clockOnly.currentTime = 10.1;
    expect(liveFrameKey(noQuality, false)).not.toBe(start);
  });
});
