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
  it('shows only the remaining experimental features and persists an explicit opt-in', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    await act(async () => root.render(<LabsSettingsDialog onClose={vi.fn()} />));
    try {
      expect(host.textContent).not.toContain('Rotary setup');
      expect(host.textContent).not.toContain('Rotary image engraving');
      // ADR-387: Fire and camera alignment left Labs; the dialog says where they went.
      expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
      expect(host.textContent).not.toContain('Low-power Fire control');
      expect(host.textContent).not.toContain('Camera alignment v2');
      expect(host.textContent).toContain('Enable Fire button');
      expect(host.textContent).toContain('Align to bed');
      const printAndCut = checkboxByLabel(host, 'Print and Cut');
      expect(printAndCut.checked).toBe(false);

      await act(async () => {
        printAndCut.checked = true;
        Simulate.change(printAndCut);
      });

      expect(useExperimentalLaserFeatures.getState().features.printAndCut).toBe(true);
      expect(localStorage.getItem('kerfdesk.experimental-laser-features.v1')).toBe(
        '{"printAndCut":true}',
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
