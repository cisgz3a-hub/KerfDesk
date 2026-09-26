// Controller audit SM-7: Smoothieware stores S in 12-bit 1.11 fixed point, so
// Machine Setup holds its Full-power S at 1 with the reason, a saved profile
// above it is corrected only by an explicit click (ADR-322 §6: no silent
// migration), and Job Review warns until it is.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SMOOTHIE_FULL_POWER_S_REASON } from '../../core/devices/smoothie-power-scale';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { LaserPowerRows } from './DeviceProfilePowerFields';
import { detectMachineJobWarnings } from './machine-job-warnings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetStore();
});

function smoothieDevice(maxPowerS: number) {
  return {
    ...useStore.getState().project.device,
    controllerKind: 'smoothieware' as const,
    maxPowerS,
  };
}

function fullPowerField(): HTMLInputElement {
  const node = host.querySelector<HTMLInputElement>('input[aria-label="Maximum laser power S"]');
  if (!node) throw new Error('Missing Full-power S field');
  return node;
}

describe('Smoothieware Full-power S in Machine Setup', () => {
  it('is locked at 1 with the 12-bit reason', () => {
    const update = vi.fn();
    act(() =>
      root.render(<LaserPowerRows plainLabels device={smoothieDevice(1)} update={update} />),
    );
    expect(fullPowerField().disabled).toBe(true);
    expect(fullPowerField().value).toBe('1');
    expect(host.textContent).toContain(SMOOTHIE_FULL_POWER_S_REASON);
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Set to 1',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('shows a saved value above it as it is, and corrects it only on request', () => {
    const update = vi.fn();
    act(() =>
      root.render(<LaserPowerRows plainLabels device={smoothieDevice(255)} update={update} />),
    );
    expect(fullPowerField().value).toBe('255');
    expect(update).not.toHaveBeenCalled();
    const setToOne = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Set to 1',
    );
    act(() => setToOne?.click());
    expect(update).toHaveBeenCalledWith({ maxPowerS: 1 });
  });

  it('leaves other controllers editable', () => {
    act(() =>
      root.render(
        <LaserPowerRows
          plainLabels
          grblLabels={false}
          device={{ ...useStore.getState().project.device, controllerKind: 'marlin' }}
          update={vi.fn()}
        />,
      ),
    );
    expect(fullPowerField().disabled).toBe(false);
  });
});

describe('Job Review for a saved Smoothieware profile above S 2', () => {
  it('warns, and stays silent at Full-power S 1', () => {
    const warned = detectMachineJobWarnings(createProject(smoothieDevice(255)));
    expect(warned.some((warning) => warning.includes('12-bit 1.11 fixed point'))).toBe(true);
    const fine = detectMachineJobWarnings(createProject(smoothieDevice(1)));
    expect(fine.some((warning) => warning.includes('12-bit 1.11 fixed point'))).toBe(false);
  });
});
