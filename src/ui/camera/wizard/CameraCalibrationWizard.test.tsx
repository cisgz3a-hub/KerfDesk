// DOM smoke tests for the wizard shell and steps: each step renders its
// operative controls in the states a test environment can reach (no real
// camera). Capture/solve BEHAVIOR is covered by the store test; the
// live-camera path is hardware-gated and verified per WORKFLOW F-CAM2.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalibrationSession, RgbaImage } from '../../../core/camera';
import type { CameraCaptureBinding } from '../../../core/camera/capture-binding';
import { createProject } from '../../../core/scene';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { cameraCaptureBindingForFrame, type ActiveCameraSource } from '../frame-source';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import { useCameraWizardStore } from './camera-wizard-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The setup step's checkerboard save goes through the platform file dialog.
const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};
const CAMERA_A: ActiveCameraSource = {
  kind: 'machine-jpeg',
  cameraUrl: 'http://192.168.10.10/capture.jpg',
  frameUrl: 'http://127.0.0.1/frame.jpg?url=camera-a',
};
const CAMERA_B: ActiveCameraSource = {
  kind: 'machine-jpeg',
  cameraUrl: 'http://192.168.10.11/capture.jpg',
  frameUrl: 'http://127.0.0.1/frame.jpg?url=camera-b',
};
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 240;
const FOCAL_LENGTH_PX = 200;
const REPROJECTION_RMS_PX = 0.25;
const POSE_SPREAD_RAD = 0.2;
const RGBA_CHANNELS = 4;
const SOLVED_SESSION: CalibrationSession = {
  kind: 'solved',
  captures: [],
  result: {
    kind: 'ok',
    intrinsics: {
      fx: FOCAL_LENGTH_PX,
      fy: FOCAL_LENGTH_PX,
      cx: FRAME_WIDTH / 2,
      cy: FRAME_HEIGHT / 2,
    },
    distortion: [0, 0, 0, 0],
    imageWidth: FRAME_WIDTH,
    imageHeight: FRAME_HEIGHT,
    views: [],
    perViewRmsPx: [],
    rmsPx: REPROJECTION_RMS_PX,
    iterations: 1,
    converged: true,
    exit: 'tolerance',
    coverage: [],
  },
  trust: { kind: 'trusted' },
  diversity: { kind: 'ok', maxSpreadRad: POSE_SPREAD_RAD },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.setState({ project: createProject() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useStore.getState().newProject();
  useCameraStore.setState({ sourceState: { kind: 'idle' } });
  useCameraWizardStore.getState().closeWizard();
});

function renderWizard(): void {
  act(() =>
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <CameraCalibrationWizard />
      </PlatformProvider>,
    ),
  );
}

function buttonByText(text: string): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;
}

describe('CameraCalibrationWizard', () => {
  it('opens on the board setup step with the three board fields', () => {
    useCameraWizardStore.getState().openWizard();
    renderWizard();
    expect(container.textContent).toContain('Calibrate camera lens');
    expect(container.querySelector('input[aria-label="Inner corners across"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Inner corners down"]')).not.toBeNull();
    expect(
      container.querySelector('input[aria-label="Checkerboard square size in millimeters"]'),
    ).not.toBeNull();
    expect(buttonByText('Start capturing')).not.toBeNull();
  });

  it('capture step without a live stream explains how to start the camera', () => {
    useCameraWizardStore.getState().openWizard();
    act(() => useCameraWizardStore.getState().setStep('capture'));
    renderWizard();
    expect(container.textContent).toContain('camera feed is not running');
  });

  it('review step renders the typed failure with a way back', () => {
    useCameraWizardStore.getState().openWizard();
    act(() => {
      useCameraWizardStore.getState().beginSolve();
      // No captures: the deferred solve resolves to a typed failure.
      useCameraWizardStore.getState().completeSolve();
    });
    renderWizard();
    expect(container.textContent).toContain('Calibration failed (too-few-views)');
    expect(buttonByText('Back to capture')).not.toBeNull();
  });

  it('discards a collecting capture set when the live camera source changes', () => {
    const captureBinding = cameraCaptureBindingForFrame(CAMERA_A, FRAME_WIDTH, FRAME_HEIGHT);
    useCameraWizardStore.getState().openWizard();
    useCameraWizardStore.setState({
      step: 'capture',
      captureBinding,
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
    });
    useCameraStore.setState({ sourceState: { kind: 'live', source: CAMERA_B } });

    renderWizard();

    const state = useCameraWizardStore.getState();
    expect(state.step).toBe('capture');
    expect(state.captureBinding).toBeNull();
    expect(state.lastRejection).toBe('source-changed');
    expect(container.textContent).toContain('camera source changed');
  });

  it('keeps solved review actionable after a live source change and applies its binding', () => {
    const captureBinding = cameraCaptureBindingForFrame(CAMERA_A, FRAME_WIDTH, FRAME_HEIGHT);
    useCameraWizardStore.getState().openWizard();
    useCameraWizardStore.setState(solvedReviewState(captureBinding));
    useCameraStore.setState({ sourceState: { kind: 'live', source: CAMERA_A } });
    renderWizard();

    act(() => useCameraStore.setState({ sourceState: { kind: 'live', source: CAMERA_B } }));

    const state = useCameraWizardStore.getState();
    expect(state.step).toBe('review');
    expect(state.session.kind).toBe('solved');
    expect(state.captureBinding).toEqual(captureBinding);
    expect(container.textContent).toContain('applying still saves the recorded source identity');
    const apply = buttonByText('Apply calibration');
    expect(apply?.disabled).toBe(false);

    act(() => apply?.click());

    expect(useStore.getState().project.device.cameraCalibration?.capture).toEqual(captureBinding);
  });
});

function solvedReviewState(captureBinding: CameraCaptureBinding) {
  return {
    step: 'review' as const,
    solving: false,
    captureBinding,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    lastFrame: blankFrame(),
    rectifiedFrame: null,
    abMode: 'rectified' as const,
    session: SOLVED_SESSION,
  };
}

function blankFrame(): RgbaImage {
  return {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    data: new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * RGBA_CHANNELS),
  };
}
