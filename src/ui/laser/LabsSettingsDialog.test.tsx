import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_LASER_FEATURES,
  useExperimentalLaserFeatures,
} from '../state/experimental-laser-features';
import { LabsSettingsDialog } from './LabsSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  useExperimentalLaserFeatures.setState({ features: DEFAULT_EXPERIMENTAL_LASER_FEATURES });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('LabsSettingsDialog', () => {
  it('starts fail-closed and persists an explicit rotary opt-in', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    await act(async () => root.render(<LabsSettingsDialog onClose={vi.fn()} />));
    try {
      const rotary = checkboxByLabel(host, 'Rotary setup');
      expect(rotary.checked).toBe(false);

      await act(async () => {
        rotary.checked = true;
        Simulate.change(rotary);
      });

      expect(useExperimentalLaserFeatures.getState().features.rotary).toBe(true);
      expect(localStorage.getItem('kerfdesk.experimental-laser-features.v1')).toContain(
        '"rotary":true',
      );
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function checkboxByLabel(host: HTMLElement, label: string): HTMLInputElement {
  const row = [...host.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  const input = row?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`${label} checkbox missing`);
  return input;
}
