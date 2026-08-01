import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../../core/camera';
import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import { createProject } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import type { ActiveCameraSource } from '../frame-source';
import { useCameraWizardStore } from './camera-wizard-store';
import { ReviewStep } from './ReviewStep';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CAPTURE_A: CameraCaptureBinding = {
  version: 1,
  sourceKind: 'machine-jpeg',
  sourceId: 'http://192.168.10.10/capture.jpg',
  width: 320,
  height: 240,
  resizeMode: 'unknown',
};
const CAMERA_A: ActiveCameraSource = {
  kind: 'machine-jpeg',
  cameraUrl: CAPTURE_A.sourceId,
  frameUrl: 'http://127.0.0.1/frame.jpg?url=camera-a',
};
const CAMERA_B: ActiveCameraSource = {
  kind: 'machine-jpeg',
  cameraUrl: 'http://192.168.10.11/capture.jpg',
  frameUrl: 'http://127.0.0.1/frame.jpg?url=camera-b',
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.setState({ project: createProject() });
  useCameraStore.setState({ sourceState: { kind: 'live', source: CAMERA_A } });
  useCameraWizardStore.getState().openWizard();
  useCameraWizardStore.setState({
    step: 'review',
    solving: false,
    captureBinding: CAPTURE_A,
    frameWidth: 320,
    frameHeight: 240,
    lastFrame: blankFrame(),
    rectifiedFrame: null,
    abMode: 'rectified',
    session: {
      kind: 'solved',
      captures: [],
      result: {
        kind: 'ok',
        intrinsics: { fx: 200, fy: 200, cx: 160, cy: 120 },
        distortion: [0, 0, 0, 0],
        imageWidth: 320,
        imageHeight: 240,
        views: [],
        perViewRmsPx: [],
        rmsPx: 0.25,
        iterations: 1,
        converged: true,
        exit: 'tolerance',
        coverage: [],
      },
      trust: { kind: 'trusted' },
      diversity: { kind: 'ok', maxSpreadRad: 0.2 },
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.getState().newProject();
  useCameraStore.setState({ sourceState: { kind: 'idle' } });
  useCameraWizardStore.getState().closeWizard();
});

describe('calibration review provenance', () => {
  it('persists the binding recorded by the accepted capture set', () => {
    act(() => root.render(<ReviewStep />));
    const apply = applyButton();

    act(() => apply.click());

    expect(useStore.getState().project.device.cameraCalibration?.capture).toEqual(CAPTURE_A);
  });

  it('does not apply the capture set while a different camera is active', () => {
    useCameraStore.setState({ sourceState: { kind: 'live', source: CAMERA_B } });
    act(() => root.render(<ReviewStep />));

    const apply = applyButton();
    expect(apply.disabled).toBe(true);
    act(() => apply.click());

    expect(useStore.getState().project.device.cameraCalibration).toBeUndefined();
  });
});

function applyButton(): HTMLButtonElement {
  const apply = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Apply calibration',
  );
  if (!(apply instanceof HTMLButtonElement)) throw new Error('Apply calibration button missing');
  return apply;
}

function blankFrame(): RgbaImage {
  return {
    width: 320,
    height: 240,
    data: new Uint8ClampedArray(320 * 240 * 4),
  };
}
