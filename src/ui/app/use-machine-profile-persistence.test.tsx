import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, DEFAULT_CNC_TILING } from '../../core/scene';
import { useStore } from '../state';
import { loadLastMachineSelection, rememberLastMachine } from '../state/last-machine-persistence';
import { createStartupProject } from '../state/startup-project';
import { resetStore } from '../state/test-helpers';
import type { CncMachinePatch } from '../state/machine-actions';
import { useMachineProfilePersistence } from './use-machine-profile-persistence';
import { runAutosaveRecovery } from './use-autosave';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const saved = { ...DEFAULT_DEVICE_PROFILE, name: 'My machine', bedWidth: 321, bedHeight: 234 };
const jobEdits: ReadonlyArray<readonly [string, CncMachinePatch]> = [
  ['stock', { stock: { thicknessMm: 29 } }],
  ['tool', { toolId: DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.id !== 'em-3175')!.id }],
  [
    'tools',
    {
      tools: DEFAULT_CNC_MACHINE_CONFIG.tools.map((tool) => ({
        ...tool,
        name: `${tool.name} edited`,
      })),
    },
  ],
  ['tiling', { tiling: DEFAULT_CNC_TILING }],
];
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

  it.each(
    jobEdits.flatMap(([name, patch]) =>
      [false, true].map((hasMirror) => ({ name, patch, hasMirror })),
    ),
  )(
    'CNC $name edit/undo/redo preserves the saved machine (profile mirror: $hasMirror)',
    ({ patch, hasMirror }) => {
      openCncFile(hasMirror);
      const before = useStore.getState().project;
      if (before.machine?.kind !== 'cnc') throw new Error('Expected CNC file');
      useStore.getState().updateCncMachine(patch);
      expect(useStore.getState().project.machine).toMatchObject({ params: before.machine.params });
      expect(useStore.getState().project.machine).not.toEqual(before.machine);
      expect(useStore.getState().project.device).not.toBe(before.device);
      expect(loadLastMachineSelection(localStorage)?.profile).toEqual(saved);
      useStore.getState().undo();
      expect(useStore.getState().project.machine).toEqual(before.machine);
      expect(loadLastMachineSelection(localStorage)?.profile).toEqual(saved);
      useStore.getState().redo();
      expect(loadLastMachineSelection(localStorage)?.profile).toEqual(saved);
    },
  );

  it('ignores semantically identical profile edits with reordered nested fields', () => {
    openCncFile(true);
    useStore.getState().updateDeviceProfile({
      homing: { direction: 'front-left', enabled: false },
    });
    expect(loadLastMachineSelection(localStorage)?.profile).toEqual(saved);
  });

  it('persists genuine CNC hardware edits and their undo/redo after Open', () => {
    openCncFile(true);
    useStore.getState().updateCncMachine({ params: { safeZMm: 17 } });
    expect(loadLastMachineSelection(localStorage)).toMatchObject({
      profile: { name: 'File CNC', cncSubProfile: { safeZMm: 17 } },
      machineKind: 'cnc',
    });
    useStore.getState().undo();
    expect(loadLastMachineSelection(localStorage)?.profile.cncSubProfile?.safeZMm).toBe(
      DEFAULT_CNC_MACHINE_CONFIG.params.safeZMm,
    );
    useStore.getState().redo();
    expect(loadLastMachineSelection(localStorage)?.profile.cncSubProfile?.safeZMm).toBe(17);
  });

  it('New retains the opened CNC machine without adopting it as the saved application choice', () => {
    openCncFile(false);
    const before = useStore.getState();
    if (before.project.machine?.kind !== 'cnc') throw new Error('Expected CNC file');
    useStore.getState().newProject();
    expect(useStore.getState().project.machine).toMatchObject({
      params: before.project.machine.params,
    });
    expect(useStore.getState().projectDocumentEpoch).toBe(before.projectDocumentEpoch + 1);
    expect(loadLastMachineSelection(localStorage)?.profile).toEqual(saved);
  });

  it('persists an explicit mode change and its undo after Open', () => {
    openCncFile(true);
    useStore.getState().setMachineKind('laser');
    expect(loadLastMachineSelection(localStorage)).toMatchObject({
      profile: { name: 'File CNC' },
      machineKind: 'laser',
    });
    useStore.getState().undo();
    expect(loadLastMachineSelection(localStorage)).toMatchObject({
      profile: { name: 'File CNC' },
      machineKind: 'cnc',
    });
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

function openCncFile(hasMirror: boolean): void {
  useStore.getState().replaceDeviceProfile(saved);
  const fileMachine = {
    ...DEFAULT_DEVICE_PROFILE,
    name: 'File CNC',
    bedWidth: 654,
    bedHeight: 432,
    ...(hasMirror ? { cncSubProfile: { ...DEFAULT_CNC_MACHINE_CONFIG.params } } : {}),
  };
  useStore.getState().setProject({
    ...createProject(fileMachine),
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG },
  });
  expect(loadLastMachineSelection(localStorage)?.profile).toEqual(saved);
}
