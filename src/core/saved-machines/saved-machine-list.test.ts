import { describe, expect, it } from 'vitest';
import { everyFieldProfile } from '../../__fixtures__/saved-machines';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../devices/falcon-profiles';
import { DEFAULT_CNC_MACHINE_PARAMS } from '../scene';
import {
  EMPTY_SAVED_MACHINE_LIST,
  MAX_SAVED_MACHINE_NAME_LENGTH,
  addSavedMachine,
  createSavedMachine,
  defaultSavedMachine,
  duplicateSavedMachine,
  findSavedMachine,
  importSavedMachine,
  removeSavedMachine,
  renameSavedMachine,
  savedMachineNameIssue,
  savedMachinesByName,
  setDefaultSavedMachine,
  uniqueSavedMachineName,
  updateSavedMachineProfile,
  type SavedMachineList,
} from './saved-machine-list';

const FINGERPRINT = { firmware: 'grbl-v1.1', settings: { $100: '80' } } as const;

function listOf(...entries: ReadonlyArray<[string, DeviceProfile]>): SavedMachineList {
  return entries.reduce<SavedMachineList>(
    (list, [id, profile]) =>
      addSavedMachine(list, createSavedMachine({ id, profile, machineKind: 'laser', now: 1 })),
    EMPTY_SAVED_MACHINE_LIST,
  );
}

describe('saved machine entries', () => {
  it('keeps the complete profile, named like the entry and pointing back at it', () => {
    const profile = everyFieldProfile();
    const machine = createSavedMachine({
      id: 'm1',
      profile,
      machineKind: 'cnc',
      name: '  Shop   4040 ',
      controllerFingerprint: FINGERPRINT,
      now: 42,
    });

    expect(machine).toMatchObject({ id: 'm1', name: 'Shop 4040', machineKind: 'cnc' });
    expect(machine.profile).toEqual({ ...profile, name: 'Shop 4040', savedMachineId: 'm1' });
    expect(machine.controllerFingerprint).toEqual(FINGERPRINT);
    expect([machine.savedAt, machine.updatedAt]).toEqual([42, 42]);
  });

  it('gives a spindle-capable machine its own spindle values instead of inheriting any', () => {
    const { cncSubProfile: _dropped, ...withoutCnc } = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;
    void _dropped;
    const machine = createSavedMachine({
      id: 'm',
      profile: withoutCnc,
      machineKind: 'cnc',
      now: 0,
    });

    expect(machine.profile.cncSubProfile).toEqual(DEFAULT_CNC_MACHINE_PARAMS);
  });

  it('lets a profile that declares its output kinds decide the mode', () => {
    const laserOnly = createSavedMachine({
      id: 'f',
      profile: FALCON_A1_PRO_GRBLHAL_PROFILE,
      machineKind: 'cnc',
      now: 0,
    });
    const legacy = createSavedMachine({
      id: 'd',
      profile: { ...DEFAULT_DEVICE_PROFILE, capabilities: [] },
      machineKind: 'cnc',
      now: 0,
    });

    expect(laserOnly.machineKind).toBe('laser');
    expect(legacy.machineKind).toBe('cnc');
  });
});

describe('saved machine list operations', () => {
  it('adds, finds and orders machines by name without accepting a duplicate id', () => {
    const list = listOf(
      ['b', { ...DEFAULT_DEVICE_PROFILE, name: 'Zeta' }],
      ['a', { ...DEFAULT_DEVICE_PROFILE, name: 'alpha' }],
    );
    const again = addSavedMachine(
      list,
      createSavedMachine({
        id: 'a',
        profile: DEFAULT_DEVICE_PROFILE,
        machineKind: 'laser',
        now: 2,
      }),
    );

    expect(savedMachinesByName(list).map((machine) => machine.name)).toEqual(['alpha', 'Zeta']);
    expect(findSavedMachine(list, 'b')?.name).toBe('Zeta');
    expect(findSavedMachine(list, undefined)).toBeUndefined();
    expect(again).toBe(list);
  });

  it('updates the profile and mode, keeping the recorded controller unless replaced', () => {
    const list = addSavedMachine(
      EMPTY_SAVED_MACHINE_LIST,
      createSavedMachine({
        id: 'm',
        profile: DEFAULT_DEVICE_PROFILE,
        machineKind: 'laser',
        name: 'Laser',
        controllerFingerprint: FINGERPRINT,
        now: 1,
      }),
    );
    const edited = { ...DEFAULT_DEVICE_PROFILE, name: 'Project copy', bedWidth: 300 };
    const kept = updateSavedMachineProfile(list, 'm', {
      profile: edited,
      machineKind: 'cnc',
      now: 5,
    });
    const replaced = updateSavedMachineProfile(list, 'm', {
      profile: edited,
      machineKind: 'laser',
      controllerFingerprint: { firmware: 'grblhal' },
      now: 6,
    });

    const machine = findSavedMachine(kept, 'm');
    expect(machine?.profile).toEqual({ ...edited, name: 'Laser', savedMachineId: 'm' });
    expect(machine?.machineKind).toBe('cnc');
    expect(machine?.controllerFingerprint).toEqual(FINGERPRINT);
    expect([machine?.savedAt, machine?.updatedAt]).toEqual([1, 5]);
    expect(findSavedMachine(replaced, 'm')?.controllerFingerprint).toEqual({ firmware: 'grblhal' });
    expect(
      updateSavedMachineProfile(list, 'missing', { profile: edited, machineKind: 'laser', now: 7 }),
    ).toBe(list);
  });

  it('renames the entry and its profile, refusing an empty or taken name', () => {
    const list = listOf(
      ['a', { ...DEFAULT_DEVICE_PROFILE, name: 'Falcon' }],
      ['b', { ...DEFAULT_DEVICE_PROFILE, name: '4040' }],
    );
    const renamed = renameSavedMachine(list, 'a', '  Falcon A1  ', 9);

    expect(findSavedMachine(renamed, 'a')).toMatchObject({ name: 'Falcon A1', updatedAt: 9 });
    expect(findSavedMachine(renamed, 'a')?.profile.name).toBe('Falcon A1');
    expect(renameSavedMachine(list, 'a', '   ', 9)).toBe(list);
    expect(renameSavedMachine(list, 'a', '4040', 9)).toBe(list);
    expect(savedMachineNameIssue(list, 'falcon', 'b')).toBe(
      'Another saved machine is already called “Falcon”.',
    );
    expect(savedMachineNameIssue(list, 'Falcon', 'a')).toBeNull();
    expect(savedMachineNameIssue(list, '')).toBe('Enter a name for this machine.');
  });

  it('duplicates every setting under a "(Duplicate)" name and a new id', () => {
    const list = addSavedMachine(
      EMPTY_SAVED_MACHINE_LIST,
      createSavedMachine({
        id: 'a',
        profile: everyFieldProfile(),
        machineKind: 'cnc',
        name: 'Router',
        controllerFingerprint: FINGERPRINT,
        now: 1,
      }),
    );
    const once = duplicateSavedMachine(list, 'a', 'b', 3);
    const twice = duplicateSavedMachine(once, 'a', 'c', 4);

    const copy = findSavedMachine(once, 'b');
    expect(copy?.name).toBe('Router (Duplicate)');
    expect(copy?.profile).toEqual({
      ...everyFieldProfile(),
      name: 'Router (Duplicate)',
      savedMachineId: 'b',
    });
    expect(copy?.machineKind).toBe('cnc');
    expect(copy?.controllerFingerprint).toEqual(FINGERPRINT);
    expect(findSavedMachine(twice, 'c')?.name).toBe('Router (Duplicate) 2');
    expect(duplicateSavedMachine(list, 'missing', 'x', 3)).toBe(list);
    expect(duplicateSavedMachine(once, 'a', 'b', 3)).toBe(once);
  });

  it('removes a machine and clears it as the default', () => {
    const list = setDefaultSavedMachine(
      listOf(['a', DEFAULT_DEVICE_PROFILE], ['b', { ...DEFAULT_DEVICE_PROFILE, name: 'Two' }]),
      'a',
    );
    const removed = removeSavedMachine(list, 'a');

    expect(defaultSavedMachine(list)?.id).toBe('a');
    expect(removed.machines.map((machine) => machine.id)).toEqual(['b']);
    expect(removed.defaultMachineId).toBeNull();
    expect(removeSavedMachine(removed, 'missing')).toBe(removed);
    expect(setDefaultSavedMachine(removed, 'missing')).toBe(removed);
    expect(setDefaultSavedMachine(list, null).defaultMachineId).toBeNull();
  });

  it('imports a file profile, keeping its saved-machine id unless that would overwrite', () => {
    const list = listOf(['shared-id', { ...DEFAULT_DEVICE_PROFILE, name: 'Falcon' }]);
    const fromOtherWorkstation = importSavedMachine(
      EMPTY_SAVED_MACHINE_LIST,
      { ...FALCON_A1_PRO_GRBLHAL_PROFILE, name: 'Falcon', savedMachineId: 'shared-id' },
      { newId: 'fresh', now: 3, preferredKind: 'laser' },
    );
    const clash = importSavedMachine(
      list,
      { ...FALCON_A1_PRO_GRBLHAL_PROFILE, name: 'Falcon', savedMachineId: 'shared-id' },
      { newId: 'fresh', now: 3, preferredKind: 'laser' },
    );

    expect(fromOtherWorkstation.machine.id).toBe('shared-id');
    expect(clash.machine.id).toBe('fresh');
    expect(clash.machine.name).toBe('Falcon 2');
    expect(clash.machine.profile.savedMachineId).toBe('fresh');
    expect(clash.list.machines.map((machine) => machine.id)).toEqual(['shared-id', 'fresh']);
    expect(findSavedMachine(clash.list, 'shared-id')?.name).toBe('Falcon');
  });

  it('imports a laser-and-spindle machine in the preferred mode it supports', () => {
    const dual = everyFieldProfile();
    const options = { newId: 'n', now: 1 } as const;

    expect(
      importSavedMachine(EMPTY_SAVED_MACHINE_LIST, dual, { ...options, preferredKind: 'cnc' })
        .machine.machineKind,
    ).toBe('cnc');
    expect(
      importSavedMachine(EMPTY_SAVED_MACHINE_LIST, FALCON_A1_PRO_GRBLHAL_PROFILE, {
        ...options,
        preferredKind: 'cnc',
      }).machine.machineKind,
    ).toBe('laser');
  });

  it('finds a unique name even at the maximum length', () => {
    const long = 'x'.repeat(MAX_SAVED_MACHINE_NAME_LENGTH);
    const list = listOf(['a', { ...DEFAULT_DEVICE_PROFILE, name: long }]);
    const unique = uniqueSavedMachineName(list, long);

    expect(unique).toHaveLength(MAX_SAVED_MACHINE_NAME_LENGTH);
    expect(unique.endsWith(' 2')).toBe(true);
    expect(savedMachineNameIssue(list, unique)).toBeNull();
  });
});
