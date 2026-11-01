import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../../core/scene';
import { resetStore } from './test-helpers';
import { useStore } from './store';

describe('opened project bed reconciliation', () => {
  beforeEach(() => resetStore());

  it('uses the opened device bed as the one runtime bed and discloses saved mismatch', () => {
    const opened = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      name: 'Opened 400 bed',
      bedWidth: 400,
      bedHeight: 300,
    });
    const result = useStore.getState().setProject({
      ...opened,
      workspace: { ...opened.workspace, width: 250, height: 200 },
    });

    expect(result).toEqual({ kind: 'loaded', projectBedReconciled: true });
    expect(useStore.getState().project.workspace).toMatchObject({ width: 400, height: 300 });
    expect(useStore.getState().projectBedReconciliation).toMatchObject({
      workspaceMismatch: true,
      openedWorkspace: { width: 250, height: 200 },
      openedBed: { width: 400, height: 300 },
    });
    expect(useStore.getState().dirty).toBe(true);
  });

  it('keeps the current machine setup when the operator chooses it after open', () => {
    const current = {
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        name: 'Current 500 bed',
        bedWidth: 500,
        bedHeight: 450,
      }),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
    };
    useStore.setState({ project: current });
    const opened = createProject({ ...DEFAULT_DEVICE_PROFILE, name: 'Opened laser' });

    useStore.getState().setProject(opened);
    useStore.getState().keepCurrentMachineForOpenedProject();

    const state = useStore.getState();
    expect(state.project.device.name).toBe('Current 500 bed');
    expect(state.project.workspace).toMatchObject({ width: 500, height: 450 });
    expect(state.project.machine).toEqual({
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: {
        ...DEFAULT_CNC_MACHINE_CONFIG.params,
        maxFeedMmPerMin: current.device.maxFeed,
        framingFeedMmPerMin: current.device.framingFeedMmPerMin,
      },
    });
    expect(state.projectBedReconciliation).toBeNull();
    expect(state.dirty).toBe(true);
  });

  it('retains the project machine when the operator accepts it', () => {
    const opened = createProject({ ...DEFAULT_DEVICE_PROFILE, name: 'Opened machine' });
    useStore.getState().setProject(opened);

    useStore.getState().acceptOpenedProjectMachine();

    expect(useStore.getState().project.device.name).toBe('Opened machine');
    expect(useStore.getState().projectBedReconciliation).toBeNull();
  });
});

// Rolling audit v5 J5-P2-2 (ADR-440 Amendment 8): a file for the same profile
// with another bed brings its whole machine, so the bed-only notice fits only
// when every field the job lock counts as the machine matches apart from the bed.
describe('bed-size-only notice', () => {
  beforeEach(() => resetStore());

  const falcon: DeviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    profileId: 'creality-falcon-a1-pro',
    name: 'Creality Falcon A1 Pro',
    bedWidth: 400,
    bedHeight: 410,
  };

  function openOlderBed(file: Partial<DeviceProfile>) {
    useStore.setState({ project: createProject(falcon) });
    useStore.getState().setProject(createProject({ ...falcon, bedHeight: 400, ...file }));
    return useStore.getState().projectBedReconciliation;
  }

  it('is bed-only when nothing else differs', () => {
    expect(openOlderBed({})).toMatchObject({
      machineChanged: true,
      sameProfile: true,
      bedSizeOnly: true,
      differingSettings: [],
    });
  });

  it.each<[string, Partial<DeviceProfile>]>([
    ['origin', { origin: 'rear-right' }],
    ['homing', { homing: { enabled: true, direction: 'rear-right' } }],
    [
      'no-go zones',
      { noGoZones: [{ id: 'z', name: 'Clamp', enabled: true, x: 0, y: 0, width: 60, height: 60 }] },
    ],
    ['scan offsets', { scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 0.2 }] }],
    ['S range', { maxPowerS: 255 }],
    ['Z setup', { zTravelMm: 40 }],
    ['Auto-focus command', { autofocusCommand: '$HZ' }],
  ])('names %s and drops the bed-only wording when the file holds another', (label, file) => {
    expect(openOlderBed(file)).toMatchObject({
      sameProfile: true,
      bedSizeOnly: false,
      differingSettings: [label],
    });
  });

  it('names what another machine brings besides its bed', () => {
    useStore.setState({ project: createProject(falcon) });
    useStore
      .getState()
      .setProject(createProject({ ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' }));
    expect(useStore.getState().projectBedReconciliation).toMatchObject({
      sameProfile: false,
      bedSizeOnly: false,
      differingSettings: expect.arrayContaining(['origin']),
    });
  });
});
