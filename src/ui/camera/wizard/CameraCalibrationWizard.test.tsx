// DOM smoke tests for the wizard shell and steps: each step renders its
// operative controls in the states a test environment can reach (no real
// camera). Capture/solve BEHAVIOR is covered by the store test; the
// live-camera path is hardware-gated and verified per WORKFLOW F-CAM2.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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
});
