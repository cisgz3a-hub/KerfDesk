// DOM tests for the workspace overlay wiring: it renders nothing without a
// persisted alignment (or when hidden), and projects a captured still through
// the alignment homography + view transform when present. The live-video
// source path shares CameraOverlay, which has its own tests.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraAlignment, CameraCalibration, RgbaImage } from '../../core/camera';
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
  planeHeightMm: 0,
};

const RECTIFIED_ALIGNMENT: CameraAlignment = { ...ALIGNMENT, basis: 'rectified' };

const CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 3, fy: 3, cx: 2, cy: 2 },
  distortion: [0.3, -0.05, 0.01, -0.002],
  imageWidth: 4,
  imageHeight: 4,
  rmsPx: 0.3,
  calibratedAt: 0,
};

const STILL: RgbaImage = {
  data: new Uint8ClampedArray(4 * 4 * 4).fill(200),
  width: 4,
  height: 4,
};

const CAPTURE = {
  version: 1 as const,
  sourceKind: 'machine-jpeg' as const,
  sourceId: 'http://192.168.10.1/frame.jpg',
  width: 4,
  height: 4,
  resizeMode: 'unknown' as const,
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
    overlayStillCapture: null,
    surfaceHeightMm: 0,
    sourceState: { kind: 'idle' },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function setAlignment(
  alignment: CameraAlignment | undefined,
  calibration?: CameraCalibration,
): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      device:
        alignment === undefined
          ? project.device
          : {
              ...project.device,
              cameraAlignment: alignment,
              ...(calibration === undefined ? {} : { cameraCalibration: calibration }),
            },
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

  it('de-fisheyes the still for a rectified alignment with calibration (R2)', () => {
    setAlignment(RECTIFIED_ALIGNMENT, CALIBRATION);
    useCameraStore.setState({ overlayStill: STILL });
    act(() => root.render(<WorkspaceCameraOverlay />));
    // Still drawn (rectified), no basis-mismatch notice.
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('shows a basis-mismatch notice instead of a mis-registered overlay (R2)', () => {
    // A rectified alignment with no calibration cannot be de-fisheyed for display.
    setAlignment(RECTIFIED_ALIGNMENT);
    useCameraStore.setState({ overlayStill: STILL });
    act(() => root.render(<WorkspaceCameraOverlay />));
    expect(container.querySelector('canvas')).toBeNull();
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain('captured still');
  });

  it('shows a setup warning instead of an overlay captured from another camera', () => {
    setAlignment({ ...ALIGNMENT, capture: CAPTURE });
    useCameraStore.setState({
      overlayStill: STILL,
      overlayStillCapture: { ...CAPTURE, sourceId: 'http://192.168.10.2/frame.jpg' },
    });
    act(() => root.render(<WorkspaceCameraOverlay />));
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).toContain('different camera');
  });
});
