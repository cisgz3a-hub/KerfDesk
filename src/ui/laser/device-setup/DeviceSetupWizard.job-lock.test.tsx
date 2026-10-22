// ADR-416 Amendment 1 (controller audit v4 E2-P2-2): a running or held job
// keeps the machine it started with. Machine Setup's Save waits for it, as the
// toolbar's Laser/CNC switch does, so a bit change cannot lose its safe-Z lift.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../../core/controllers/grbl';
import { SCULPFUN_S30_PROFILE } from '../../../core/devices/brand-laser-profiles';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  LASER_MACHINE_CONFIG,
  machineKindOf,
} from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { deviceSetupReducer, initDeviceSetup, type DeviceSetupState } from './device-setup-flow';
import { mockPlatform, renderWizard } from './device-setup-wizard.test-support';
import { SETUP_SAVE_LOCKED_DURING_JOB, useMachineSetupSave } from './use-machine-setup-save';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  clearToasts();
  useStore.setState((state) => ({
    project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
  }));
});

afterEach(() => {
  useLaserStore.setState({ streamer: null });
  clearToasts();
  resetStore();
});

/** A two-bit CNC job held at its tool change (M0), as the toolbar test holds it. */
function holdAtToolChange(): void {
  useLaserStore.setState({
    streamer: { ...createStreamer('G0 Z5\nM0\nG0 Z5\n'), status: 'tool-change', inFlight: [] },
  });
}

describe('Machine Setup Save during a job', () => {
  it('keeps a CNC project in CNC while a bit change holds the job', async () => {
    holdAtToolChange();
    const undoDepth = useStore.getState().undoStack.length;
    const onClose = vi.fn();
    const save = await mountSave(laserDraft(), onClose);
    try {
      expect(save.current().lockedByJob).toBe(true);
      await act(async () => save.current().onSave());
      const project = useStore.getState().project;
      expect(machineKindOf(project.machine)).toBe('cnc');
      expect(project.device.profileId).not.toBe(SCULPFUN_S30_PROFILE.profileId);
      expect(useStore.getState().undoStack).toHaveLength(undoDepth);
      expect(onClose).not.toHaveBeenCalled();
      expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
        message: SETUP_SAVE_LOCKED_DURING_JOB,
        variant: 'warning',
      });
    } finally {
      await save.unmount();
    }
  });

  it('saves once the job has ended', async () => {
    holdAtToolChange();
    const onClose = vi.fn();
    const save = await mountSave(laserDraft(), onClose);
    try {
      await act(async () => {
        useLaserStore.setState({
          streamer: { ...createStreamer('G0 Z5\n'), status: 'cancelled', inFlight: [] },
        });
      });
      expect(save.current().lockedByJob).toBe(false);
      await act(async () => save.current().onSave());
      expect(machineKindOf(useStore.getState().project.machine)).toBe('laser');
      expect(useStore.getState().project.device.profileId).toBe(SCULPFUN_S30_PROFILE.profileId);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      await save.unmount();
    }
  });

  it('disables Save in the rendered setup and says why', async () => {
    holdAtToolChange();
    const view = await renderWizard(undefined, mockPlatform(), { configuredAs: 'cnc' });
    try {
      await act(async () =>
        radio(view.host, 'Use Sculpfun S30 (5 W, stock automatic air)').click(),
      );
      await act(async () => button(view.host, 'Next').click());
      await act(async () => button(view.host, 'Next').click());
      const save = button(view.host, 'Save machine setup');
      expect(save.disabled).toBe(true);
      expect(save.title).toContain(SETUP_SAVE_LOCKED_DURING_JOB);
      expect(view.host.querySelector('.lf-setup-job-lock')?.textContent).toBe(
        SETUP_SAVE_LOCKED_DURING_JOB,
      );
      expect(machineKindOf(useStore.getState().project.machine)).toBe('cnc');

      await act(async () => useLaserStore.setState({ streamer: null }));
      expect(button(view.host, 'Save machine setup').disabled).toBe(false);
      expect(view.host.querySelector('.lf-setup-job-lock')).toBeNull();
    } finally {
      await view.unmount();
    }
  });
});

/** The setup draft with the Sculpfun S30 chosen: a laser-only machine. */
function laserDraft(): DeviceSetupState {
  const project = useStore.getState().project;
  const state = initDeviceSetup(project.device, null, {
    machine: project.machine ?? LASER_MACHINE_CONFIG,
  });
  const chosen = deviceSetupReducer(state, { kind: 'apply-preset', profile: SCULPFUN_S30_PROFILE });
  expect(chosen.draftMachine.kind).toBe('laser');
  return chosen;
}

async function mountSave(
  state: DeviceSetupState,
  onClose: () => void,
): Promise<{
  readonly current: () => ReturnType<typeof useMachineSetupSave>;
  readonly unmount: () => Promise<void>;
}> {
  let save: ReturnType<typeof useMachineSetupSave> | undefined;
  function Probe(): null {
    save = useMachineSetupSave({
      state,
      operationDrafts: [],
      customTools: [],
      materialApplyRequested: false,
      onClose,
    });
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () => root.render(<Probe />));
  return {
    current: () => {
      if (save === undefined) throw new Error('Machine setup save hook missing');
      return save;
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function clearToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}

function radio(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const match = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
    (candidate) => candidate.getAttribute('aria-label')?.startsWith(ariaLabel),
  );
  if (!(match instanceof HTMLInputElement)) throw new Error(`Radio missing: ${ariaLabel}`);
  return match;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
