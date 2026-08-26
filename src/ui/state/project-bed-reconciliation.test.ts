import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
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
    expect(state.project.machine).toEqual(DEFAULT_CNC_MACHINE_CONFIG);
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
