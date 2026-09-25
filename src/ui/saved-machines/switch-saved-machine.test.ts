import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { everyFieldProfile } from '../../__fixtures__/saved-machines';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
  type SavedMachineList,
} from '../../core/saved-machines/saved-machine-list';
import type { MachineKind } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { resetStore } from '../state/test-helpers';
import { switchFeedback } from './switch-feedback';
import { switchToSavedMachine } from './switch-saved-machine';

function install(
  ...entries: ReadonlyArray<[string, DeviceProfile, MachineKind]>
): SavedMachineList {
  const list = entries.reduce<SavedMachineList>(
    (acc, [id, profile, machineKind]) =>
      addSavedMachine(acc, createSavedMachine({ id, profile, machineKind, now: 1 })),
    EMPTY_SAVED_MACHINE_LIST,
  );
  useSavedMachinesStore.setState({ list, persistFailed: false });
  return list;
}

function savedProfile(list: SavedMachineList, id: string): DeviceProfile {
  const machine = list.machines.find((entry) => entry.id === id);
  if (machine === undefined) throw new Error(`missing ${id}`);
  return machine.profile;
}

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
});

afterEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useSavedMachinesStore.setState({ list: EMPTY_SAVED_MACHINE_LIST, persistFailed: false });
});

describe('switch to a saved machine', () => {
  it('replaces every profile field and the output mode in one undoable change', () => {
    const list = install(['router', everyFieldProfile(), 'cnc']);
    const before = useStore.getState().project;

    const result = switchToSavedMachine('router');

    const project = useStore.getState().project;
    expect(result.kind).toBe('switched');
    expect(project.device).toEqual(savedProfile(list, 'router'));
    expect(project.workspace).toMatchObject({ width: 380, height: 390 });
    expect(project.machine?.kind).toBe('cnc');
    if (project.machine?.kind === 'cnc') {
      expect(project.machine.params).toEqual(everyFieldProfile().cncSubProfile);
    }
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().dirty).toBe(true);

    useStore.getState().undo();
    expect(useStore.getState().project.device).toEqual(before.device);
    expect(useStore.getState().project.machine).toEqual(before.machine);
  });

  it('never keeps the previous machine’s bed, origin, power range or dialect', () => {
    install(
      ['router', everyFieldProfile(), 'cnc'],
      ['falcon', FALCON_A1_PRO_GRBLHAL_PROFILE, 'laser'],
    );
    switchToSavedMachine('router');

    switchToSavedMachine('falcon');

    const device = useStore.getState().project.device;
    expect(device.bedWidth).toBe(FALCON_A1_PRO_GRBLHAL_PROFILE.bedWidth);
    expect(device.bedHeight).toBe(FALCON_A1_PRO_GRBLHAL_PROFILE.bedHeight);
    expect(device.origin).toBe(FALCON_A1_PRO_GRBLHAL_PROFILE.origin);
    expect(device.maxPowerS).toBe(FALCON_A1_PRO_GRBLHAL_PROFILE.maxPowerS);
    expect(device.minPowerS).toBe(FALCON_A1_PRO_GRBLHAL_PROFILE.minPowerS);
    expect(device.gcodeDialect).toEqual(FALCON_A1_PRO_GRBLHAL_PROFILE.gcodeDialect);
    expect(device.scanningOffsets).toEqual(FALCON_A1_PRO_GRBLHAL_PROFILE.scanningOffsets);
    expect(device.noGoZones).toEqual(FALCON_A1_PRO_GRBLHAL_PROFILE.noGoZones);
    expect(device.rotary).toEqual(FALCON_A1_PRO_GRBLHAL_PROFILE.rotary);
    expect(device.savedMachineId).toBe('falcon');
    expect(useStore.getState().project.machine?.kind).toBe('laser');
  });

  it('can open a laser-and-spindle machine in the other mode it supports', () => {
    install(['router', everyFieldProfile(), 'cnc']);

    const result = switchToSavedMachine('router', { machineKind: 'laser' });

    expect(result.kind).toBe('switched');
    expect(useStore.getState().project.machine?.kind).toBe('laser');
    expect(useStore.getState().project.device.cncSubProfile).toEqual(
      everyFieldProfile().cncSubProfile,
    );
  });

  it('refuses while the machine is busy and leaves the project alone', () => {
    install(['falcon', FALCON_A1_PRO_GRBLHAL_PROFILE, 'laser']);
    const before = useStore.getState().project;
    useLaserStore.setState({ fireActive: true });

    const result = switchToSavedMachine('falcon');

    expect(result).toEqual({
      kind: 'blocked',
      reason: 'Test fire is on. Turn it off before switching machines.',
    });
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('reports a machine that is no longer saved', () => {
    install();

    expect(switchToSavedMachine('gone')).toEqual({ kind: 'missing' });
    expect(switchFeedback({ kind: 'missing' }).tone).toBe('error');
  });

  it('asks for a reconnect when the live connection uses another controller driver', () => {
    install(
      ['falcon', FALCON_A1_PRO_GRBLHAL_PROFILE, 'laser'],
      ['plain', DEFAULT_DEVICE_PROFILE, 'laser'],
    );
    useLaserStore.setState({
      connection: { kind: 'connected' },
      activeControllerKind: 'grbl-v1.1',
    });

    const falcon = switchToSavedMachine('falcon');
    const plain = switchToSavedMachine('plain');

    expect(falcon).toMatchObject({ kind: 'switched', reconnect: true });
    expect(switchFeedback(falcon)).toMatchObject({ tone: 'warning' });
    expect(switchFeedback(falcon).text).toContain('Disconnect and reconnect');
    expect(plain).toMatchObject({ kind: 'switched', reconnect: false });
    expect(switchFeedback(plain)).toEqual({
      tone: 'success',
      text: `Switched to “${DEFAULT_DEVICE_PROFILE.name}”. Frame the job again before Start.`,
    });
  });
});
