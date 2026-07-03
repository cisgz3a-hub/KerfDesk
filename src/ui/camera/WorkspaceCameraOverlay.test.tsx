// DOM tests for the workspace overlay wiring: it renders nothing without a
// persisted alignment (or when hidden), and projects a captured still through
// the alignment homography + view transform when present. The live-video
// source path shares CameraOverlay, which has its own tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraAlignment, RgbaImage } from '../../core/camera';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { WorkspaceCameraOverlay } from './WorkspaceCameraOverlay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ALIGNMENT: CameraAlignment = {
  homography: [0.2, 0, 10, 0, 0.2, 5, 0, 0, 1],
  frameWidth: 1280,
  frameHeight: 720,
  basis: 'raw',
  alignedAt: 0,
};

const STILL: RgbaImage = {
  data: new Uint8ClampedArray(4 * 4 * 4).fill(200),
  width: 4,
  height: 4,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom cannot measure layout; give the overlay box a real-looking rect so
  // the view transform computes (the canvas-area box the overlay covers).
  vi.spyOn(HTMLDivElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useCameraStore.setState({
    overlayVisible: true,
    overlayOpacityPercent: 50,
    overlayStill: null,
    stream: { kind: 'idle' },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function setAlignment(alignment: CameraAlignment | undefined): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      device:
        alignment === undefined
          ? project.device
          : { ...project.device, cameraAlignment: alignment },
    },
  });
}

describe('WorkspaceCameraOverlay', () => {
  it('renders nothing without a persisted alignment', () => {
    setAlignment(undefined);
    useCameraStore.setState({ overlayStill: STILL });
    act(() => root.render(<WorkspaceCameraOverlay />));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the overlay is hidden', () => {
    setAlignment(ALIGNMENT);
    useCameraStore.setState({ overlayStill: STILL, overlayVisible: false });
    act(() => root.render(<WorkspaceCameraOverlay />));
    expect(container.innerHTML).toBe('');
  });

  it('projects a captured still through the alignment and view', () => {
    setAlignment(ALIGNMENT);
    useCameraStore.setState({ overlayStill: STILL });
    act(() => root.render(<WorkspaceCameraOverlay />));
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas!.style.transform).toContain('matrix3d(');
    expect(canvas!.style.opacity).toBe('0.5');
    expect(canvas!.style.pointerEvents).toBe('none');
  });

  it('renders nothing when there is neither a still nor a live stream', () => {
    setAlignment(ALIGNMENT);
    act(() => root.render(<WorkspaceCameraOverlay />));
    expect(container.innerHTML).toBe('');
  });
});
