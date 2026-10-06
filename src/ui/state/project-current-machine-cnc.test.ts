import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  LASER_MACHINE_CONFIG,
  layerCncTool,
  type CncMachineConfig,
  type MachineKind,
  type Project,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { projectForModeSwitch } from './mode-switch-settings';
import { projectWithCurrentJobSetup } from './project-job-setup';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const CNC_PLACEMENT = { startFrom: 'current-position', anchor: 'back-left' } as const;
const LASER_PLACEMENT = { startFrom: 'user-origin', anchor: 'center' } as const;
const jobTool = { id: 'job-tool', name: 'Job 6 mm', kind: 'end-mill', diameterMm: 6 } as const;
const registrationTool = {
  ...jobTool,
  id: 'registration-tool',
  name: 'Registration 2 mm',
  diameterMm: 2,
};
const workshopCnc: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [{ ...jobTool, diameterMm: 3.175 }],
  toolId: jobTool.id,
  stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 45 },
  params: {
    safeZMm: 10,
    spindleMaxRpm: 24000,
    spindleSpinupSec: 2,
    coolant: 'mist',
    parkXMm: 15,
    parkYMm: 25,
    parkZMm: 17,
    maxFeedMmPerMin: 6200,
    framingFeedMmPerMin: 1700,
  },
};
const fileCnc: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [jobTool, registrationTool],
  toolId: jobTool.id,
  stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 29, materialKey: 'plywood-mdf' },
  params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 19 },
  tiling: {
    tileWidthMm: 123,
    tileHeightMm: 234,
    overlapMm: 10,
    registrationHoles: true,
    registration: {
      toolId: registrationTool.id,
      holeDiameterMm: 3,
      depthMm: 4,
      depthPerPassMm: 1,
      feedMmPerMin: 700,
      plungeMmPerMin: 150,
      spindleRpm: 9000,
    },
  },
};

function reset(): void {
  localStorage.clear();
  resetStore();
  useStore.setState({ cachedCncMachine: null });
}
beforeEach(reset);
afterEach(reset);

function open(project: Project): void {
  const parsed = deserializeProject(serializeProject(project));
  if (parsed.kind !== 'ok') throw new Error('Expected a codec-accepted project');
  useStore.getState().setProject(parsed.project);
}

function workshop(kind: MachineKind, mirror: 'absent' | 'stale' = 'stale'): Project {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      name: 'Workshop machine',
      maxFeed: 9000,
      framingFeedMmPerMin: 800,
      ...(mirror === 'stale' ? { cncSubProfile: DEFAULT_CNC_MACHINE_CONFIG.params } : {}),
    }),
    machine: kind === 'cnc' ? workshopCnc : LASER_MACHINE_CONFIG,
    ...(kind === 'laser' ? { parkedCncMachine: workshopCnc } : {}),
  };
}

function file(kind: MachineKind): Project {
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, name: 'File machine' });
  const cnc: Project = {
    ...base,
    machine: fileCnc,
    jobSetup: { ...base.jobSetup, placement: CNC_PLACEMENT, parkedPlacement: LASER_PLACEMENT },
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'saved-operation', color: '#ff0000' }),
          output: true,
          parkedOutput: false,
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: jobTool.id },
        },
      ],
    },
  };
  return kind === 'cnc'
    ? cnc
    : {
        ...projectForModeSwitch(cnc, 'cnc', 'laser'),
        machine: LASER_MACHINE_CONFIG,
        parkedCncMachine: fileCnc,
      };
}

function expectKeptSetup(kind: MachineKind): void {
  const state = useStore.getState();
  const cnc =
    state.project.machine?.kind === 'cnc' ? state.project.machine : state.project.parkedCncMachine;
  if (cnc === undefined) throw new Error('Expected the opened CNC job');
  expect(state.project.machine?.kind).toBe(kind);
  expect(cnc.params).toEqual(workshopCnc.params);
  expect(state.project.device.cncSubProfile).toEqual(workshopCnc.params);
  expect(state.project.device).toMatchObject({ name: 'Workshop machine', maxFeed: 9000 });
  expect(cnc.stock).toEqual(fileCnc.stock);
  expect(cnc.toolId).toBe(jobTool.id);
  expect(cnc.tools).toEqual(expect.arrayContaining([...fileCnc.tools]));
  expect(cnc.tiling).toEqual(fileCnc.tiling);
  const layer = state.project.scene.layers[0];
  if (layer?.cnc === undefined) throw new Error('Expected saved operation settings');
  expect(layerCncTool(cnc, layer.cnc)).toEqual(jobTool);
  expect(layer.cnc).toEqual({ ...DEFAULT_CNC_LAYER_SETTINGS, toolId: jobTool.id });
  expect(layer.output).toBe(kind === 'cnc');
  expect(state.jobPlacement).toEqual(kind === 'cnc' ? CNC_PLACEMENT : LASER_PLACEMENT);
  expect(state.project.jobSetup.placement).toEqual(state.jobPlacement);
  expect(state.project.parkedCncMachine === undefined).toBe(kind === 'cnc');
}

describe('Keep current machine combines hardware with the opened CNC job', () => {
  it.each([
    ['cnc', 'cnc', 'stale'],
    ['laser', 'cnc', 'absent'],
    ['cnc', 'laser', 'absent'],
    ['laser', 'laser', 'stale'],
  ] as const)(
    'keeps %s hardware for a %s file with a %s device mirror through history, save and New',
    (keptKind, openedKind, mirror) => {
      open(workshop(keptKind, mirror));
      open(file(openedKind));
      useStore.getState().keepCurrentMachineForOpenedProject();
      expectKeptSetup(keptKind);
      const before = useStore.getState();
      const otherKind = keptKind === 'cnc' ? 'laser' : 'cnc';
      useStore.getState().setMachineKind(otherKind);
      expectKeptSetup(otherKind);
      const switched = useStore.getState();
      useStore.getState().undo();
      expectKeptSetup(keptKind);
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().cachedCncMachine).toEqual(before.cachedCncMachine);
      useStore.getState().redo();
      expectKeptSetup(otherKind);
      expect(useStore.getState().project).toBe(switched.project);
      useStore.getState().undo();

      const saved = projectWithCurrentJobSetup(useStore.getState());
      reset();
      open(saved);
      expectKeptSetup(keptKind);
      useStore.getState().setMachineKind(otherKind);
      expectKeptSetup(otherKind);

      useStore.getState().newProject();
      expect(useStore.getState().project.scene.layers).toEqual([]);
      useStore.getState().setMachineKind('cnc');
      const fresh = useStore.getState().project.machine;
      if (fresh?.kind !== 'cnc') throw new Error('Expected fresh CNC job');
      expect(fresh.params).toEqual(workshopCnc.params);
      expect(fresh.stock).toEqual(DEFAULT_CNC_MACHINE_CONFIG.stock);
      expect(fresh.toolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
      expect(fresh.tools.some((tool) => tool.id === jobTool.id)).toBe(false);
      expect(fresh.tiling).toBeUndefined();
    },
  );

  it('starts a fresh CNC setup when the opened file has no CNC job', () => {
    open(workshop('cnc'));
    open(createProject({ ...DEFAULT_DEVICE_PROFILE, name: 'Laser-only file' }));
    useStore.getState().keepCurrentMachineForOpenedProject();
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('Expected current CNC hardware');
    expect(machine.params).toEqual(workshopCnc.params);
    expect(machine.stock).toEqual(DEFAULT_CNC_MACHINE_CONFIG.stock);
    expect(machine.toolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
    expect(machine.tools.some((tool) => tool.id === jobTool.id)).toBe(false);
    expect(machine.tiling).toBeUndefined();
  });

  it('uses retained CNC hardware from the device when there is no previous parked job', () => {
    const previous = workshop('laser');
    const { parkedCncMachine: _parked, ...withoutParked } = previous;
    open({ ...withoutParked, device: { ...previous.device, cncSubProfile: workshopCnc.params } });
    open(file('cnc'));
    useStore.getState().keepCurrentMachineForOpenedProject();
    expectKeptSetup('laser');
    useStore.getState().setMachineKind('cnc');
    expectKeptSetup('cnc');
  });
});
