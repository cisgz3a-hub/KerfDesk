// ProbeControls is mounted in three places (the CNC machine rail, the
// Device-Setup wizard step, ProbePanel). With the form in component state each
// mount kept a private copy, so plate geometry and probe depths dialled in one
// were absent from the other — which then probed with defaults and zeroed Z at
// the wrong height.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CNC_MACHINE_CATALOG } from '../../core/cnc';
import { DEFAULT_Z_PROBE_PARAMS } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { ProbeControls } from './ProbeControls';
import { deviceProfileSignature } from './device-setup/device-setup-nudge';
import {
  DEFAULT_CORNER_PROBE_GEOMETRY,
  probeFormContextKey,
  probeFormForContext,
  useProbeFormStore,
} from './probe-form-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  useLaserStore.setState({ controllerSessionEpoch: 0 });
  useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
  useProbeFormStore.setState({ draftsByContext: {} });
});

async function mount(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProbeControls />));
  return { host, root };
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const found = host.querySelector(`select[aria-label="${label}"]`);
  if (!(found instanceof HTMLSelectElement)) throw new Error(`${label} select missing`);
  return found;
}

function numberInput(host: HTMLElement, label: string): HTMLInputElement {
  const found = host.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return found;
}

function currentProbeContextKey(): string {
  const state = useStore.getState();
  return probeFormContextKey(
    state.projectDocumentEpoch,
    state.probeSetupEpoch,
    useLaserStore.getState().controllerSessionEpoch,
  );
}

function installSavedMachineProfiles(): void {
  useStore.setState((state) => ({
    cncLibrary: {
      ...state.cncLibrary,
      machineProfiles: [
        { id: 'machine-a', name: 'Machine A', machine: DEFAULT_CNC_MACHINE_CONFIG },
        { id: 'machine-b', name: 'Machine B', machine: DEFAULT_CNC_MACHINE_CONFIG },
      ],
    },
  }));
}

const MACHINE_SETUP_TRANSITIONS: ReadonlyArray<{
  readonly name: string;
  readonly apply: () => void;
}> = [
  {
    name: 'catalog preset',
    apply: () => {
      const preset = CNC_MACHINE_CATALOG.find((candidate) => candidate.id === 'shapeoko-xxl');
      if (preset === undefined) throw new Error('shapeoko preset missing');
      useStore.getState().applyCncMachinePreset(preset);
    },
  },
  {
    name: 'detected machine setup',
    apply: () =>
      useStore.getState().applyCncMachineSetup({
        devicePatch: { bedWidth: 750, bedHeight: 610 },
        paramsPatch: { spindleMaxRpm: 24_000 },
      }),
  },
];

describe('ProbeControls shared form', () => {
  it('shows one mount’s probe mode on every other mount', async () => {
    useStore.getState().setMachineKind('cnc');
    const rail = await mount();
    const wizard = await mount();
    try {
      const railMode = select(rail.host, 'Probe mode');
      expect(select(wizard.host, 'Probe mode').value).toBe('z');

      await act(async () => {
        railMode.value = 'corner';
        Simulate.change(railMode);
      });

      // Both surfaces describe the same pending probe.
      expect(select(wizard.host, 'Probe mode').value).toBe('corner');
      const key = currentProbeContextKey();
      expect(probeFormForContext(useProbeFormStore.getState(), key).mode).toBe('corner');
    } finally {
      await act(async () => rail.root.unmount());
      await act(async () => wizard.root.unmount());
      rail.host.remove();
      wizard.host.remove();
    }
  });

  it('does not carry a profile or document draft into a different probe context', async () => {
    useStore.getState().setMachineKind('cnc');
    const initialKey = currentProbeContextKey();
    useProbeFormStore.getState().setMode(initialKey, 'corner');
    useProbeFormStore.getState().setZParams(initialKey, {
      ...DEFAULT_Z_PROBE_PARAMS,
      plateThicknessMm: 17,
    });
    useProbeFormStore.getState().setCornerGeometry(initialKey, {
      ...DEFAULT_CORNER_PROBE_GEOMETRY,
      plateCenterOffsetXmm: 23,
    });

    const controls = await mount();
    try {
      expect(select(controls.host, 'Probe mode').value).toBe('corner');
      expect(numberInput(controls.host, 'Plate thickness').value).toBe('17');
      expect(numberInput(controls.host, 'Plate center X offset').value).toBe('23');

      await act(async () => {
        useStore.getState().replaceDeviceProfile({
          ...DEFAULT_DEVICE_PROFILE,
          profileId: 'different-cnc-profile',
          name: 'Different CNC profile',
        });
      });

      expect(select(controls.host, 'Probe mode').value).toBe('z');
      expect(numberInput(controls.host, 'Plate thickness').value).toBe(
        String(DEFAULT_Z_PROBE_PARAMS.plateThicknessMm),
      );

      const profileKey = currentProbeContextKey();
      expect(probeFormForContext(useProbeFormStore.getState(), profileKey).cornerGeometry).toEqual(
        DEFAULT_CORNER_PROBE_GEOMETRY,
      );

      await act(async () => useStore.getState().newProject());
      const documentKey = currentProbeContextKey();
      expect(documentKey).not.toBe(profileKey);
      expect(probeFormForContext(useProbeFormStore.getState(), documentKey).zParams).toEqual(
        DEFAULT_Z_PROBE_PARAMS,
      );
    } finally {
      await act(async () => controls.root.unmount());
      controls.host.remove();
    }
  });

  it('does not collide when replacement profiles share the passive device signature', async () => {
    useStore.getState().setMachineKind('cnc');
    const sharedProfileFields = {
      ...useStore.getState().project.device,
      profileId: 'same-imported-profile',
      name: 'Same imported profile',
    };
    const machineAProfile = {
      ...sharedProfileFields,
      cncSubProfile: {
        safeZMm: 3,
        spindleMaxRpm: 12_000,
        spindleSpinupSec: 3,
      },
    };
    const machineBProfile = {
      ...sharedProfileFields,
      cncSubProfile: {
        ...machineAProfile.cncSubProfile,
        safeZMm: 17,
      },
    };
    expect(deviceProfileSignature(machineAProfile)).toBe(deviceProfileSignature(machineBProfile));

    useStore.getState().replaceDeviceProfile(machineAProfile);
    const machineAKey = currentProbeContextKey();
    useProbeFormStore.getState().setMode(machineAKey, 'corner');
    useProbeFormStore.getState().setZParams(machineAKey, {
      ...DEFAULT_Z_PROBE_PARAMS,
      plateThicknessMm: 17,
    });

    const controls = await mount();
    try {
      expect(select(controls.host, 'Probe mode').value).toBe('corner');
      await act(async () => useStore.getState().replaceDeviceProfile(machineBProfile));

      const machineBKey = currentProbeContextKey();
      expect(machineBKey).not.toBe(machineAKey);
      expect(select(controls.host, 'Probe mode').value).toBe('z');
      expect(numberInput(controls.host, 'Plate thickness').value).toBe(
        String(DEFAULT_Z_PROBE_PARAMS.plateThicknessMm),
      );
    } finally {
      await act(async () => controls.root.unmount());
      controls.host.remove();
    }
  });

  it('cancels a pending numeric commit when the probe context changes', async () => {
    vi.useFakeTimers();
    useStore.getState().setMachineKind('cnc');
    installSavedMachineProfiles();
    useStore.getState().applyCncMachineProfile('machine-a');
    const initialKey = currentProbeContextKey();
    const controls = await mount();
    try {
      const plateThickness = numberInput(controls.host, 'Plate thickness');
      await act(async () => {
        plateThickness.value = '17';
        Simulate.change(plateThickness);
      });

      await act(async () => {
        useStore.getState().applyCncMachineProfile('machine-b');
      });
      await act(async () => vi.advanceTimersByTime(350));

      const nextKey = currentProbeContextKey();
      expect(probeFormForContext(useProbeFormStore.getState(), initialKey).zParams).toEqual(
        DEFAULT_Z_PROBE_PARAMS,
      );
      expect(probeFormForContext(useProbeFormStore.getState(), nextKey).zParams).toEqual(
        DEFAULT_Z_PROBE_PARAMS,
      );
      expect(numberInput(controls.host, 'Plate thickness').value).toBe(
        String(DEFAULT_Z_PROBE_PARAMS.plateThicknessMm),
      );
    } finally {
      await act(async () => controls.root.unmount());
      controls.host.remove();
      vi.useRealTimers();
    }
  });

  it('does not carry a draft into a new controller session under the same generic profile', async () => {
    useStore.getState().setMachineKind('cnc');
    const machineAKey = currentProbeContextKey();
    useProbeFormStore.getState().setMode(machineAKey, 'corner');
    useProbeFormStore.getState().setZParams(machineAKey, {
      ...DEFAULT_Z_PROBE_PARAMS,
      plateThicknessMm: 17,
    });
    useProbeFormStore.getState().setCornerGeometry(machineAKey, {
      ...DEFAULT_CORNER_PROBE_GEOMETRY,
      plateCenterOffsetXmm: 23,
    });

    const controls = await mount();
    try {
      expect(select(controls.host, 'Probe mode').value).toBe('corner');
      expect(numberInput(controls.host, 'Plate thickness').value).toBe('17');

      await act(async () => {
        useLaserStore.setState((state) => ({
          controllerSessionEpoch: state.controllerSessionEpoch + 1,
        }));
      });

      const machineBKey = currentProbeContextKey();
      expect(machineBKey).not.toBe(machineAKey);
      expect(select(controls.host, 'Probe mode').value).toBe('z');
      expect(numberInput(controls.host, 'Plate thickness').value).toBe(
        String(DEFAULT_Z_PROBE_PARAMS.plateThicknessMm),
      );
      expect(probeFormForContext(useProbeFormStore.getState(), machineBKey).cornerGeometry).toEqual(
        DEFAULT_CORNER_PROBE_GEOMETRY,
      );
    } finally {
      await act(async () => controls.root.unmount());
      controls.host.remove();
    }
  });

  it('cancels a pending numeric commit when the controller session changes', async () => {
    vi.useFakeTimers();
    useStore.getState().setMachineKind('cnc');
    const machineAKey = currentProbeContextKey();
    const controls = await mount();
    try {
      const plateThickness = numberInput(controls.host, 'Plate thickness');
      await act(async () => {
        plateThickness.value = '17';
        Simulate.change(plateThickness);
      });

      await act(async () => {
        useLaserStore.setState((state) => ({
          controllerSessionEpoch: state.controllerSessionEpoch + 1,
        }));
      });
      await act(async () => vi.advanceTimersByTime(350));

      const machineBKey = currentProbeContextKey();
      expect(probeFormForContext(useProbeFormStore.getState(), machineAKey).zParams).toEqual(
        DEFAULT_Z_PROBE_PARAMS,
      );
      expect(probeFormForContext(useProbeFormStore.getState(), machineBKey).zParams).toEqual(
        DEFAULT_Z_PROBE_PARAMS,
      );
      expect(numberInput(controls.host, 'Plate thickness').value).toBe(
        String(DEFAULT_Z_PROBE_PARAMS.plateThicknessMm),
      );
    } finally {
      await act(async () => controls.root.unmount());
      controls.host.remove();
      vi.useRealTimers();
    }
  });

  it('does not carry a draft across real saved CNC machine profile selection', async () => {
    useStore.getState().setMachineKind('cnc');
    installSavedMachineProfiles();
    useStore.getState().applyCncMachineProfile('machine-a');
    const machineAKey = currentProbeContextKey();
    useProbeFormStore.getState().setMode(machineAKey, 'corner');
    useProbeFormStore.getState().setZParams(machineAKey, {
      ...DEFAULT_Z_PROBE_PARAMS,
      plateThicknessMm: 17,
    });
    useProbeFormStore.getState().setCornerGeometry(machineAKey, {
      ...DEFAULT_CORNER_PROBE_GEOMETRY,
      plateCenterOffsetXmm: 23,
    });

    const controls = await mount();
    try {
      expect(select(controls.host, 'Probe mode').value).toBe('corner');
      expect(numberInput(controls.host, 'Plate thickness').value).toBe('17');

      await act(async () => useStore.getState().applyCncMachineProfile('machine-b'));

      const machineBKey = currentProbeContextKey();
      expect(machineBKey).not.toBe(machineAKey);
      expect(select(controls.host, 'Probe mode').value).toBe('z');
      expect(numberInput(controls.host, 'Plate thickness').value).toBe(
        String(DEFAULT_Z_PROBE_PARAMS.plateThicknessMm),
      );
      expect(probeFormForContext(useProbeFormStore.getState(), machineBKey).cornerGeometry).toEqual(
        DEFAULT_CORNER_PROBE_GEOMETRY,
      );
    } finally {
      await act(async () => controls.root.unmount());
      controls.host.remove();
    }
  });

  it.each(MACHINE_SETUP_TRANSITIONS)(
    'does not carry a draft across a real $name transition',
    async ({ apply }) => {
      useStore.getState().setMachineKind('cnc');
      const machineAKey = currentProbeContextKey();
      useProbeFormStore.getState().setMode(machineAKey, 'corner');
      useProbeFormStore.getState().setZParams(machineAKey, {
        ...DEFAULT_Z_PROBE_PARAMS,
        plateThicknessMm: 17,
      });

      const controls = await mount();
      try {
        expect(select(controls.host, 'Probe mode').value).toBe('corner');
        await act(async () => apply());

        const machineBKey = currentProbeContextKey();
        expect(machineBKey).not.toBe(machineAKey);
        expect(select(controls.host, 'Probe mode').value).toBe('z');
        expect(numberInput(controls.host, 'Plate thickness').value).toBe(
          String(DEFAULT_Z_PROBE_PARAMS.plateThicknessMm),
        );
      } finally {
        await act(async () => controls.root.unmount());
        controls.host.remove();
      }
    },
  );

  it('does not reuse an unprofiled draft after saved-profile undo and redo', async () => {
    useStore.getState().setMachineKind('cnc');
    installSavedMachineProfiles();
    const unprofiledAKey = currentProbeContextKey();
    useProbeFormStore.getState().setMode(unprofiledAKey, 'corner');
    useProbeFormStore.getState().setZParams(unprofiledAKey, {
      ...DEFAULT_Z_PROBE_PARAMS,
      plateThicknessMm: 17,
    });

    const controls = await mount();
    try {
      expect(select(controls.host, 'Probe mode').value).toBe('corner');

      await act(async () => useStore.getState().applyCncMachineProfile('machine-b'));
      const savedBKey = currentProbeContextKey();
      expect(savedBKey).not.toBe(unprofiledAKey);
      expect(select(controls.host, 'Probe mode').value).toBe('z');

      await act(async () => useStore.getState().undo());
      const undoAKey = currentProbeContextKey();
      expect(undoAKey).not.toBe(unprofiledAKey);
      expect(undoAKey).not.toBe(savedBKey);
      expect(select(controls.host, 'Probe mode').value).toBe('z');

      await act(async () => useStore.getState().redo());
      const redoBKey = currentProbeContextKey();
      expect(redoBKey).not.toBe(unprofiledAKey);
      expect(redoBKey).not.toBe(savedBKey);
      expect(redoBKey).not.toBe(undoAKey);
      expect(select(controls.host, 'Probe mode').value).toBe('z');
      expect(numberInput(controls.host, 'Plate thickness').value).toBe(
        String(DEFAULT_Z_PROBE_PARAMS.plateThicknessMm),
      );
    } finally {
      await act(async () => controls.root.unmount());
      controls.host.remove();
    }
  });
});
