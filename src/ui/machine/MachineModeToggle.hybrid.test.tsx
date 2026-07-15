import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG, machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { MachineModeToggle } from './MachineModeToggle';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useStore.setState({ cachedCncMachine: null });
  clearToasts();
});

afterEach(() => {
  clearToasts();
  resetStore();
});

function clearToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}

async function renderToggle(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<MachineModeToggle />));
  return { host, root };
}

function modeButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return button;
}

describe('MachineModeToggle machine capability', () => {
  it('keeps CNC visibly locked and explains the block for a laser-only profile', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: { ...state.project.device, capabilities: ['laser-output'] },
        machine: LASER_MACHINE_CONFIG,
      },
    }));
    const { host, root } = await renderToggle();
    try {
      expect(modeButton(host, 'Laser').disabled).toBe(false);
      const cnc = modeButton(host, 'CNC');
      expect(cnc.disabled).toBe(false);
      expect(cnc.getAttribute('aria-disabled')).toBe('true');
      expect(cnc.title).toContain('This machine is set to Laser only');
      await act(async () => cnc.click());
      expect(machineKindOf(useStore.getState().project.machine)).toBe('laser');
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringContaining('CNC mode is unavailable'),
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps Laser visibly locked and explains the block for a CNC-only profile', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          capabilities: ['cnc-output'],
          cncSubProfile: DEFAULT_CNC_MACHINE_CONFIG.params,
        },
        machine: DEFAULT_CNC_MACHINE_CONFIG,
      },
    }));
    const { host, root } = await renderToggle();
    try {
      const laser = modeButton(host, 'Laser');
      expect(laser.disabled).toBe(false);
      expect(laser.getAttribute('aria-disabled')).toBe('true');
      await act(async () => laser.click());
      expect(machineKindOf(useStore.getState().project.machine)).toBe('cnc');
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringContaining('Laser mode is unavailable'),
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('enables both modes on a hybrid profile and restores its CNC contract', async () => {
    const cncSubProfile = { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 11 };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          capabilities: ['laser-output', 'cnc-output'],
          cncSubProfile,
        },
        machine: LASER_MACHINE_CONFIG,
      },
    }));
    const { host, root } = await renderToggle();
    try {
      const cnc = modeButton(host, 'CNC');
      expect(cnc.disabled).toBe(false);
      expect(cnc.getAttribute('aria-disabled')).toBe('false');
      await act(async () => cnc.click());
      const state = useStore.getState();
      expect(machineKindOf(state.project.machine)).toBe('cnc');
      expect(state.project.machine?.kind === 'cnc' ? state.project.machine.params.safeZMm : 0).toBe(
        11,
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
