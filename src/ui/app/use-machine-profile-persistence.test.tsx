import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from '../state';
import { loadLastMachineSelection, rememberLastMachine } from '../state/last-machine-persistence';
import { createStartupProject } from '../state/startup-project';
import { resetStore } from '../state/test-helpers';
import { useMachineProfilePersistence } from './use-machine-profile-persistence';
import { runAutosaveRecovery } from './use-autosave';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const saved = { ...DEFAULT_DEVICE_PROFILE, name: 'My machine', bedWidth: 321, bedHeight: 234 };
let root: Root;
let host: HTMLDivElement;
function Probe(): null {
  useMachineProfilePersistence();
  return null;
}

beforeEach(async () => {
  localStorage.clear();
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  resetStore();
});

describe('application machine persistence', () => {
  it('retains committed machine changes across New and startup without persisting job settings', () => {
    useStore.getState().replaceDeviceProfile(saved);
    useStore.getState().setJobPlacement({ startFrom: 'current-position', anchor: 'center' });
    useStore.getState().newProject();
    expect(useStore.getState().project.device).toEqual(saved);
    expect(loadLastMachineSelection(localStorage)).toEqual({
      profile: saved,
      machineKind: 'laser',
    });
    const restarted = createStartupProject();
    expect(restarted.device).toEqual(saved);
    expect(restarted.jobSetup).toEqual(createProject(saved).jobSetup);
    expect(restarted.scene.objects).toEqual([]);
  });

  it('retains selected CNC mode and machine parameters, but resets job stock at startup and New', () => {
    useStore.getState().replaceDeviceProfile(saved);
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ params: { safeZMm: 17 }, stock: { thicknessMm: 29 } });
    const restarted = createStartupProject();
    expect(restarted.machine?.kind).toBe('cnc');
    if (restarted.machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    expect(restarted.machine.params.safeZMm).toBe(17);
    expect(restarted.machine.stock).toEqual(DEFAULT_CNC_MACHINE_CONFIG.stock);
    useStore.getState().newProject();
    expect(useStore.getState().project.machine).toEqual(restarted.machine);
  });

  it('Open keeps document settings without replacing the separately saved app machine', () => {
    useStore.getState().replaceDeviceProfile(saved);
    const openedMachine = { ...saved, name: 'File machine', bedWidth: 456 };
    const opened = createProject(openedMachine);
    useStore.getState().setProject(opened);
    expect(useStore.getState().project.device).toEqual(openedMachine);
    expect(loadLastMachineSelection(localStorage)?.profile).toEqual(saved);
    expect(createStartupProject().device).toEqual(saved);
  });

  it('recovers an autosaved job over the restored machine without replacing app preferences', async () => {
    rememberLastMachine(localStorage, saved);
    useStore.getState().setProject(createStartupProject());
    const recovered = {
      ...createProject({ ...saved, name: 'Autosaved machine' }),
      notes: 'Keep job',
    };
    await runAutosaveRecovery(() => true, {
      readLatest: async () => ({
        snapshot: {
          project: recovered,
          savedAt: 100,
          storageKey: 'old-slot',
          sessionId: 'old',
          backend: 'local',
          ownership: 'abandoned',
        },
        warnings: [],
        unreadable: [],
      }),
      retainRecovered: async () => undefined,
      write: async () => ({ kind: 'ok', savedAt: 101, storageKey: 'new-slot', backend: 'local' }),
      clearRecovered: async () => ({ kind: 'ok' }),
    });
    expect(useStore.getState().project).toEqual(recovered);
    expect(useStore.getState().dirty).toBe(true);
    expect(loadLastMachineSelection(localStorage)?.profile).toEqual(saved);
  });

  it('validates absent/corrupt storage and keeps old CNC-only profile records usable', () => {
    expect(createStartupProject().device).toEqual(DEFAULT_DEVICE_PROFILE);
    rememberLastMachine(localStorage, { ...saved, capabilities: ['cnc-output'] }, 'cnc');
    const legacy = JSON.parse(localStorage.getItem('kerfdesk.last-machine.v1')!) as Record<
      string,
      unknown
    >;
    delete legacy.machineKind;
    localStorage.setItem('kerfdesk.last-machine.v1', JSON.stringify(legacy));
    expect(createStartupProject().machine?.kind).toBe('cnc');
    localStorage.setItem('kerfdesk.last-machine.v1', '{bad');
    expect(createStartupProject().device).toEqual(DEFAULT_DEVICE_PROFILE);
  });
});
