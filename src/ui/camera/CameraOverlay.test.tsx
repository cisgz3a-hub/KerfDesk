import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraAlignment, Mat3 } from '../../core/camera';
import type { ViewTransform } from '../workspace/view-transform';
import { CameraOverlay } from './CameraOverlay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const VIEW: ViewTransform = { scale: 2, offsetX: 10, offsetY: 20 };
const ALIGNMENT: CameraAlignment = {
  homography: IDENTITY,
  frameWidth: 1280,
  frameHeight: 720,
  basis: 'raw',
  alignedAt: 0,
};

const USB_CAPTURE = {
  version: 1 as const,
  sourceKind: 'usb' as const,
  sourceId: 'overhead-camera',
  width: 1280,
  height: 720,
  resizeMode: 'none' as const,
};

let container: HTMLDivElement;
let root: Root;
let srcObjectValue: MediaStream | null = null;

beforeEach(() => {
  // jsdom implements neither srcObject nor play(); stub them so the effect runs.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get: () => srcObjectValue,
    set: (value: MediaStream | null) => {
      srcObjectValue = value;
    },
  });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  srcObjectValue = null;
});

describe('CameraOverlay', () => {
  it('renders the live video with a matrix3d transform and opacity, and attaches the stream', () => {
    const stream = {} as MediaStream;
    act(() => {
      root.render(
        <CameraOverlay
          stream={stream}
          alignment={ALIGNMENT}
          view={VIEW}
          opacityPercent={60}
          captureBinding={null}
        />,
      );
    });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.style.transform).toContain('matrix3d(');
    expect(video!.style.opacity).toBe('0.6');
    expect(video!.style.transformOrigin).toBe('0 0');
    expect(srcObjectValue).toBe(stream);
  });

  it('rescales the homography to the live frame resolution, not the calibration basis (Codex audit P2)', () => {
    const stream = {} as MediaStream;
    act(() => {
      root.render(
        <CameraOverlay
          stream={stream}
          alignment={ALIGNMENT}
          view={VIEW}
          opacityPercent={100}
          captureBinding={null}
        />,
      );
    });
    const video = container.querySelector('video')!;
    const beforeMetadata = video.style.transform;

    // A 640×360 stream is half the 1280×720 calibration, so the homography's
    // pixel input is scaled ×2 — the transform must differ from the raw one.
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 360 });
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(video.style.transform).toContain('matrix3d(');
    expect(video.style.transform).not.toBe(beforeMetadata);
  });

  it('clears srcObject on unmount so the camera is released', () => {
    const stream = {} as MediaStream;
    act(() => {
      root.render(
        <CameraOverlay
          stream={stream}
          alignment={ALIGNMENT}
          view={VIEW}
          opacityPercent={100}
          captureBinding={null}
        />,
      );
    });
    expect(srcObjectValue).toBe(stream);
    act(() => root.unmount());
    expect(srcObjectValue).toBeNull();
    root = createRoot(container); // fresh root for afterEach teardown
  });

  it('replaces the video with a setup warning when live geometry no longer matches', () => {
    const stream = {} as MediaStream;
    act(() => {
      root.render(
        <CameraOverlay
          stream={stream}
          alignment={{ ...ALIGNMENT, capture: USB_CAPTURE }}
          view={VIEW}
          opacityPercent={100}
          captureBinding={USB_CAPTURE}
        />,
      );
    });
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 });
    act(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(container.querySelector('video')).toBeNull();
    expect(container.textContent).toContain('capture shape differs');
  });
});
