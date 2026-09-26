import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncMachineConfig, type Project } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);
afterEach(resetStore);

function cncProjectWithCustomSetup(): void {
  useStore.getState().setMachineKind('cnc');
  useStore.getState().updateCncMachine({
    toolId: 'em-1588',
    stock: { thicknessMm: 18, widthMm: 300 },
    params: { safeZMm: 9 },
    tiling: { tileWidthMm: 200, tileHeightMm: 150, overlapMm: 5, registrationHoles: true },
  });
}

function saveAndReopen(project: Project): void {
  const prepared = prepareProjectForPersistence(project);
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  const opened = deserializeProject(prepared.json);
  if (opened.kind !== 'ok') throw new Error('expected the saved file to open');
  resetStore();
  useStore.getState().setProject(opened.project);
}

function expectCustomSetup(): void {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC mode');
  expect(machine.toolId).toBe('em-1588');
  expect(machine.stock).toMatchObject({ thicknessMm: 18, widthMm: 300 });
  expect(machine.params.safeZMm).toBe(9);
  expect(machine.tiling).toMatchObject({ tileWidthMm: 200, overlapMm: 5, registrationHoles: true });
}

describe('CNC setup kept through a Laser-mode save', () => {
  it('restores stock, bit, params and tiling after saving and reopening in Laser mode', () => {
    cncProjectWithCustomSetup();
    useStore.getState().setMachineKind('laser');

    saveAndReopen(useStore.getState().project);
    expect(useStore.getState().project.machine?.kind).toBe('laser');
    useStore.getState().setMachineKind('cnc');

    expectCustomSetup();
    expect(useStore.getState().project.parkedCncMachine).toBeUndefined();
  });

  it('parks the setup on the project only while it is in Laser mode', () => {
    cncProjectWithCustomSetup();
    expect(useStore.getState().project.parkedCncMachine).toBeUndefined();

    useStore.getState().setMachineKind('laser');
    expect(useStore.getState().project.parkedCncMachine?.toolId).toBe('em-1588');

    useStore.getState().undo();
    expect(useStore.getState().project.machine?.kind).toBe('cnc');
    expect(useStore.getState().project.parkedCncMachine).toBeUndefined();
  });

  it('keeps the setup through a Machine Setup save that picks Laser', () => {
    cncProjectWithCustomSetup();
    const { device } = useStore.getState().project;
    useStore.getState().replaceMachineSetup(device, { kind: 'laser' });

    saveAndReopen(useStore.getState().project);
    useStore.getState().setMachineKind('cnc');

    expectCustomSetup();
  });

  it('never loads a parked setup alongside a CNC machine', () => {
    const base = useStore.getState().project;
    const file = serializeProject({
      ...base,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      parkedCncMachine: { ...DEFAULT_CNC_MACHINE_CONFIG, toolId: 'em-1588' },
    });

    const opened = deserializeProject(file);

    expect(opened.kind).toBe('ok');
    if (opened.kind === 'ok') expect(opened.project.parkedCncMachine).toBeUndefined();
  });

  it('refuses a file whose parked setup is not a CNC config', () => {
    const base = useStore.getState().project;
    const file = serializeProject({
      ...base,
      parkedCncMachine: { kind: 'laser' } as unknown as CncMachineConfig,
    });

    expect(deserializeProject(file).kind).not.toBe('ok');
  });
});
