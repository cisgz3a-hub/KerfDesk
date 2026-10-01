import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_TILING,
  LASER_MACHINE_CONFIG,
  machineKindOf,
  type Project,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  localStorage.clear();
  resetStore();
});
afterEach(() => {
  localStorage.clear();
  resetStore();
});

function legacyCncProject(mirror: 'absent' | 'stale'): Project {
  const device = {
    ...DEFAULT_DEVICE_PROFILE,
    name: 'Legacy CNC',
    bedWidth: 654,
    bedHeight: 432,
    ...(mirror === 'stale' ? { cncSubProfile: DEFAULT_CNC_MACHINE_CONFIG.params } : {}),
  };
  const base = createProject(device);
  return {
    ...base,
    notes: 'Old job notes',
    jobSetup: { ...base.jobSetup, laserMaterial: { name: 'Old material', autoApplyRecipes: true } },
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: {
        ...DEFAULT_CNC_MACHINE_CONFIG.params,
        safeZMm: 19,
        spindleMaxRpm: 7000,
        maxFeedMmPerMin: 3333,
        framingFeedMmPerMin: 800,
      },
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 29, materialKey: 'plywood-mdf' },
      tools: [{ ...DEFAULT_CNC_MACHINE_CONFIG.tools[0]!, id: 'file-only-bit' }],
      toolId: 'file-only-bit',
      tiling: DEFAULT_CNC_TILING,
    },
  };
}

function openCodecProject(project: Project): void {
  const parsed = deserializeProject(serializeProject(project));
  if (parsed.kind !== 'ok') throw new Error('Expected a valid project codec round trip');
  useStore.getState().setProject(parsed.project);
}

function assertFreshCncJob(): void {
  const state = useStore.getState();
  if (state.project.machine?.kind !== 'cnc') throw new Error('Expected CNC mode');
  expect(state.project.machine.stock).toEqual(DEFAULT_CNC_MACHINE_CONFIG.stock);
  expect(state.project.machine.toolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
  expect(state.project.machine.tools.some((tool) => tool.id === 'file-only-bit')).toBe(false);
  expect(state.project.machine.tiling).toBeUndefined();
  expect(state.project.jobSetup.laserMaterial).toBeUndefined();
  expect(state.project.notes).toBe('');
  expect(state.project.scene).toEqual(createProject().scene);
  expect(state.dirty).toBe(false);
  expect(state.undoStack).toEqual([]);
}

describe('New from codec-accepted CNC projects', () => {
  it.each(['absent', 'stale'] as const)(
    'keeps active hardware with an %s device mirror while resetting document settings',
    (mirror) => {
      openCodecProject(legacyCncProject(mirror));
      const before = useStore.getState();
      if (before.project.machine?.kind !== 'cnc') throw new Error('Expected CNC mode');
      expect(before.project.machine.params.safeZMm).toBe(19);
      expect(before.project.machine.stock.materialKey).toBe('plywood-mdf');
      expect(before.project.machine.toolId).toBe('file-only-bit');
      useStore.getState().newProject();
      expect(useStore.getState().project.machine).toMatchObject({
        params: before.project.machine.params,
      });
      expect(useStore.getState().project.device).toEqual({
        ...before.project.device,
        cncSubProfile: before.project.machine.params,
      });
      expect(useStore.getState().projectDocumentEpoch).toBe(before.projectDocumentEpoch + 1);
      expect(useStore.getState().cncLibrary).toBe(before.cncLibrary);
      assertFreshCncJob();
    },
  );

  it.each(['absent', 'stale', 'current'] as const)(
    'keeps Laser and parked CNC hardware with a %s mirror, but discards the parked job',
    (mirror) => {
      const cnc = legacyCncProject(mirror === 'stale' ? 'stale' : 'absent');
      if (cnc.machine?.kind !== 'cnc') throw new Error('Expected CNC fixture');
      openCodecProject({
        ...cnc,
        device:
          mirror === 'current' ? { ...cnc.device, cncSubProfile: cnc.machine.params } : cnc.device,
        machine: LASER_MACHINE_CONFIG,
        parkedCncMachine: cnc.machine,
      });
      const { device, parkedCncMachine } = useStore.getState().project;
      expect(parkedCncMachine?.params.safeZMm).toBe(19);
      useStore.getState().newProject();
      expect(machineKindOf(useStore.getState().project.machine)).toBe('laser');
      expect(useStore.getState().project.device).toEqual({
        ...device,
        cncSubProfile: parkedCncMachine?.params,
      });
      expect(useStore.getState().project.parkedCncMachine).toBeUndefined();
      expect(useStore.getState().project.jobSetup.laserMaterial).toBeUndefined();
      useStore.getState().setMachineKind('cnc');
      expect(useStore.getState().project.machine).toMatchObject({
        params: cnc.machine.params,
        stock: DEFAULT_CNC_MACHINE_CONFIG.stock,
        toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      });
      expect(useStore.getState().project.machine).not.toHaveProperty('tiling');
    },
  );
});
