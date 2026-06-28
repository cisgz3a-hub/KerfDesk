import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mat3 } from '../../core/camera';
import type { ViewTransform } from '../workspace/view-transform';
import { CameraOverlay } from './CameraOverlay';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const VIEW: ViewTransform = { scale: 2, offsetX: 10, offsetY: 20 };

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
        <CameraOverlay stream={stream} homography={IDENTITY} view={VIEW} opacityPercent={60} />,
      );
    });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.style.transform).toContain('matrix3d(');
    expect(video!.style.opacity).toBe('0.6');
    expect(video!.style.transformOrigin).toBe('0 0');
    expect(srcObjectValue).toBe(stream);
  });

  it('clears srcObject on unmount so the camera is released', () => {
    const stream = {} as MediaStream;
    act(() => {
      root.render(
        <CameraOverlay stream={stream} homography={IDENTITY} view={VIEW} opacityPercent={100} />,
      );
    });
    expect(srcObjectValue).toBe(stream);
    act(() => root.unmount());
    expect(srcObjectValue).toBeNull();
    root = createRoot(container); // fresh root for afterEach teardown
  });
});
