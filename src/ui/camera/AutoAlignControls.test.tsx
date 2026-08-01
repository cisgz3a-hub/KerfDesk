import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_LASER_FEATURES,
  useExperimentalLaserFeatures,
} from '../state/experimental-laser-features';
import { useCameraAlignWizardStore } from './align-wizard/camera-align-wizard-store';
import { AutoAlignControls } from './AutoAlignControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useExperimentalLaserFeatures.setState({ features: DEFAULT_EXPERIMENTAL_LASER_FEATURES });
  useCameraAlignWizardStore.getState().closeWizard();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('AutoAlignControls', () => {
  it('requires the Labs opt-in and then exposes the marker alignment flow', () => {
    act(() => root.render(<AutoAlignControls />));
    const button = alignButton(host);
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('Tools > Labs');

    act(() => useExperimentalLaserFeatures.getState().setFeature('cameraAlignmentV2', true));
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(host.textContent).toContain('Align camera to bed');
    expect(button.title).toContain('burn the marker target');
    expect(useCameraAlignWizardStore.getState().open).toBe(true);
  });
});

function alignButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes('Align to bed'),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('Align to bed button missing');
  return button;
}
