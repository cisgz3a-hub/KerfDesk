import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CameraCalibration } from '../../core/camera';
import { useStore } from '../state';
import { useCameraAlignWizardStore } from './align-wizard/camera-align-wizard-store';
import { AutoAlignControls } from './AutoAlignControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LENS_CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 800, fy: 800, cx: 320, cy: 240 },
  distortion: [0, 0, 0, 0],
  imageWidth: 640,
  imageHeight: 480,
  rmsPx: 0.4,
  calibratedAt: 1,
};

const originalProject = useStore.getState().project;
let host: HTMLDivElement;
let root: Root;

function setLensCalibration(calibration: CameraCalibration | undefined): void {
  const project = useStore.getState().project;
  const { cameraCalibration: _previous, ...device } = project.device;
  useStore.setState({
    project: {
      ...project,
      device: calibration === undefined ? device : { ...device, cameraCalibration: calibration },
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  setLensCalibration(undefined);
  useCameraAlignWizardStore.getState().closeWizard();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useCameraAlignWizardStore.getState().closeWizard();
  useStore.setState({ project: originalProject });
  localStorage.clear();
});

// ADR-387: Align to bed left Labs. A lens calibration is its only gate, for
// USB and RTSP cameras alike; every check on the alignment itself stays in
// the wizard.
describe('AutoAlignControls', () => {
  it('waits for a lens calibration, then opens the marker alignment flow without Labs', () => {
    act(() => root.render(<AutoAlignControls />));
    const button = alignButton(host);
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('Calibrate the lens first');
    expect(button.title).not.toContain('Labs');

    act(() => setLensCalibration(LENS_CALIBRATION));
    expect(button.disabled).toBe(false);
    expect(button.title).toContain('burn the marker target');

    act(() => button.click());
    expect(host.textContent).toContain('Align camera to bed');
    expect(useCameraAlignWizardStore.getState().open).toBe(true);
  });

  it('ignores a retired Labs camera switch left in storage', () => {
    localStorage.setItem(
      'kerfdesk.experimental-laser-features.v1',
      JSON.stringify({ lowPowerFire: false, printAndCut: false, cameraAlignmentV2: false }),
    );
    setLensCalibration(LENS_CALIBRATION);
    act(() => root.render(<AutoAlignControls />));

    expect(alignButton(host).disabled).toBe(false);
  });

  it('closes an open wizard when the lens calibration is removed', () => {
    setLensCalibration(LENS_CALIBRATION);
    act(() => root.render(<AutoAlignControls />));
    act(() => alignButton(host).click());
    expect(useCameraAlignWizardStore.getState().open).toBe(true);

    act(() => setLensCalibration(undefined));

    expect(useCameraAlignWizardStore.getState().open).toBe(false);
    expect(host.textContent).not.toContain('Align camera to bed');
    expect(alignButton(host).disabled).toBe(true);
  });
});

function alignButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes('Align to bed'),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('Align to bed button missing');
  return button;
}
