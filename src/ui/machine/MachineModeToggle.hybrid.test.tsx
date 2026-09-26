import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ControllerKind, DeviceProfile } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG, machineKindOf } from '../../core/scene';
import { createStreamer } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { MODE_LOCKED_DURING_JOB, MachineModeToggle } from './MachineModeToggle';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useStore.setState({ cachedCncMachine: null });
  clearToasts();
});

afterEach(() => {
  useLaserStore.setState({ streamer: null });
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
  it('keeps CNC available and warns for a laser-only-labelled profile', async () => {
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
      expect(cnc.getAttribute('aria-disabled')).toBeNull();
      expect(cnc.dataset['capabilityWarning']).toBe('true');
      expect(cnc.title).toContain('profile declares Laser only');
      await act(async () => cnc.click());
      expect(machineKindOf(useStore.getState().project.machine)).toBe('cnc');
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringContaining('capability label is a warning'),
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps Laser available and warns for a CNC-only-labelled profile', async () => {
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
      expect(laser.getAttribute('aria-disabled')).toBeNull();
      await act(async () => laser.click());
      expect(machineKindOf(useStore.getState().project.machine)).toBe('laser');
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringContaining('capability label is a warning'),
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
      expect(cnc.getAttribute('aria-disabled')).toBeNull();
      expect(cnc.dataset['capabilityWarning']).toBeUndefined();
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

// CN-2 (2026-09-25 controller audit): an unlabelled profile whose controller
// cannot run KerfDesk CNC jobs used to switch to CNC without a word.
describe('MachineModeToggle controller fact', () => {
  it('warns with the GRBL-family reason on an unlabelled Marlin profile, and still switches', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: unlabelledDevice(state.project.device, 'marlin'),
        machine: LASER_MACHINE_CONFIG,
      },
    }));
    const { host, root } = await renderToggle();
    try {
      const cnc = modeButton(host, 'CNC');
      expect(cnc.dataset['capabilityWarning']).toBe('true');
      expect(cnc.title).toContain('GRBL-family controller');
      expect(modeButton(host, 'Laser').dataset['capabilityWarning']).toBeUndefined();
      await act(async () => cnc.click());
      expect(machineKindOf(useStore.getState().project.machine)).toBe('cnc');
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        variant: 'warning',
        message: expect.stringContaining(
          "this profile's controller (Marlin) cannot run KerfDesk CNC jobs",
        ),
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('says nothing for an unlabelled GRBL-family profile', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: unlabelledDevice(state.project.device, 'grblhal'),
        machine: LASER_MACHINE_CONFIG,
      },
    }));
    const { host, root } = await renderToggle();
    try {
      const cnc = modeButton(host, 'CNC');
      expect(cnc.dataset['capabilityWarning']).toBeUndefined();
      await act(async () => cnc.click());
      expect(useToastStore.getState().toasts).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

describe('MachineModeToggle during a job', () => {
  it('keeps a CNC project in CNC while a bit change holds the job', async () => {
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    useLaserStore.setState({
      streamer: { ...createStreamer('G0 Z5\nM0\nG0 Z5\n'), status: 'tool-change', inFlight: [] },
    });
    const { host, root } = await renderToggle();
    try {
      const laser = modeButton(host, 'Laser');
      expect(laser.disabled).toBe(true);
      expect(laser.title).toBe(MODE_LOCKED_DURING_JOB);
      expect(modeButton(host, 'CNC').disabled).toBe(false);
      await act(async () => laser.click());
      expect(machineKindOf(useStore.getState().project.machine)).toBe('cnc');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('switches again once the job has ended', async () => {
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    useLaserStore.setState({ streamer: { ...createStreamer('G1 X1\n'), status: 'cancelled' } });
    const { host, root } = await renderToggle();
    try {
      await act(async () => modeButton(host, 'Laser').click());
      expect(machineKindOf(useStore.getState().project.machine)).toBe('laser');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

function unlabelledDevice(device: DeviceProfile, controllerKind: ControllerKind): DeviceProfile {
  const { capabilities: _label, ...unlabelled } = device;
  return { ...unlabelled, controllerKind };
}
