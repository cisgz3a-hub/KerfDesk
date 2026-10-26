import { describe, expect, it } from 'vitest';
import { CNC_MACHINE_CATALOG } from '../../../core/cnc';
import { DEFAULT_DEVICE_PROFILE, GRBL_MACHINE_PROFILE_CATALOG } from '../../../core/devices';
import { FALCON_COMPATIBLE_PROFILE } from '../../../core/devices/falcon-profiles';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../../core/scene';
import { deviceSetupReducer, initDeviceSetup, type DeviceSetupState } from './device-setup-flow';
import {
  CUSTOM_MACHINE_NAME,
  chooseCustomMachineActions,
  chooseMachineEntryActions,
  draftIsCustomMachine,
  filterMachinePickerEntries,
  groupMachinePickerEntries,
  machinePickerEntries,
  selectedMachineEntry,
  type MachinePickerEntry,
} from './machine-picker-entries';

function starter(): DeviceSetupState {
  return initDeviceSetup(DEFAULT_DEVICE_PROFILE, null, { machine: LASER_MACHINE_CONFIG });
}

function choose(state: DeviceSetupState, name: string): DeviceSetupState {
  return chooseMachineEntryActions(state, listed(state, name)).reduce(deviceSetupReducer, state);
}

function listed(state: DeviceSetupState, name: string): MachinePickerEntry {
  const found = machinePickerEntries(state).find((item) => item.name === name);
  if (found === undefined) throw new Error(`No listed machine named ${name}`);
  return found;
}

describe('machine list (ADR-637)', () => {
  it('lists every brand laser profile and CNC preset, and no generic firmware starter', () => {
    const entries = machinePickerEntries(starter());
    const brandLasers = GRBL_MACHINE_PROFILE_CATALOG.filter(
      (item) => item.profile.vendor !== 'Generic' && item.withdrawn === undefined,
    );
    expect(entries).toHaveLength(brandLasers.length + CNC_MACHINE_CATALOG.length);
    expect(entries.some((item) => item.name.startsWith('Generic'))).toBe(false);
    expect(entries.some((item) => item.name === DEFAULT_DEVICE_PROFILE.name)).toBe(false);
  });

  // Controller audit v2 C7-P2-3 (ADR-660): listed under Creality with no Falcon
  // A1 row beside it, the 400 x 400 mm fallback gave an A1 (305 x 381 mm) a
  // bounds check 95 mm deeper than the machine.
  it('leaves the withdrawn Falcon-compatible fallback out, and opens a saved copy as not listed', () => {
    const entries = machinePickerEntries(starter());
    expect(entries.some((item) => item.id === FALCON_COMPATIBLE_PROFILE.profileId)).toBe(false);
    const creality = groupMachinePickerEntries(entries).find((group) => group.brand === 'Creality');
    expect(creality?.entries.map((item) => item.name)).toEqual([
      'Creality Falcon A1 Pro (vendor command set)',
    ]);

    const saved = initDeviceSetup(FALCON_COMPATIBLE_PROFILE, null, {
      machine: LASER_MACHINE_CONFIG,
    });
    expect(selectedMachineEntry(saved, machinePickerEntries(saved))).toBeUndefined();
    expect(draftIsCustomMachine(saved, machinePickerEntries(saved))).toBe(true);
    expect(saved.draft).toMatchObject({ bedWidth: 400, bedHeight: 400 });
  });

  it('groups by brand from A to Z and shows each model without its brand', () => {
    const groups = groupMachinePickerEntries(machinePickerEntries(starter()));
    const brands = groups.map((group) => group.brand);
    expect(brands).toEqual(
      [...brands].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    );
    const ortur = groups.find((group) => group.brand === 'Ortur');
    expect(ortur?.entries.map((item) => item.model)).toContain('Laser Master 3 (LU2-10A, 10 W)');
    const neotronics = groups.find((group) => group.brand === 'Neotronics');
    expect(neotronics?.entries.map((item) => item.kind).sort()).toEqual([
      'cnc-preset',
      'laser-profile',
    ]);
  });

  it('searches by brand, size and type, and filters by machine type', () => {
    const entries = machinePickerEntries(starter());
    expect(
      filterMachinePickerEntries(entries, 'sculpfun', 'all').map((item) => item.brand),
    ).toEqual(['Sculpfun', 'Sculpfun']);
    expect(filterMachinePickerEntries(entries, '838x838', 'all').map((item) => item.name)).toEqual([
      'Shapeoko 3 XXL',
    ]);
    const cnc = filterMachinePickerEntries(entries, '', 'cnc');
    expect(cnc.every((item) => item.machineKinds.includes('cnc'))).toBe(true);
    // The Laser + CNC Neotronics profile counts as both.
    expect(cnc.some((item) => item.kind === 'laser-profile')).toBe(true);
    expect(filterMachinePickerEntries(entries, 'cnc', 'laser').map((item) => item.name)).toEqual([
      'Neotronics 4040 Max / LT-4LDS-V2 20W',
    ]);
  });

  it('chooses a CNC preset as a CNC-only machine with its name, size and spindle ceiling', () => {
    const chosen = choose(starter(), 'Shapeoko 3 (Standard)');
    expect(chosen.machineKinds).toEqual(['cnc']);
    expect(chosen.draft).toMatchObject({ name: 'Shapeoko 3 (Standard)', bedWidth: 425 });
    expect(chosen.cncDraft.params.spindleMaxRpm).toBe(30000);
    expect(selectedMachineEntry(chosen, machinePickerEntries(chosen))?.name).toBe(
      'Shapeoko 3 (Standard)',
    );
  });

  it('starts a CNC preset from the generic starter when a listed laser was chosen', () => {
    const laser = choose(starter(), 'Sculpfun S30 (5 W, stock automatic air)');
    const cnc = choose(laser, 'Genmitsu 3018-PRO');
    expect(cnc.draft.profileId).toBe(DEFAULT_DEVICE_PROFILE.profileId);
    expect(cnc.draft.name).toBe('Genmitsu 3018-PRO');
    expect(cnc.draft.capabilities).not.toContain('air-assist');
    const entries = machinePickerEntries(cnc);
    expect(entries.filter((item) => selectedMachineEntry(cnc, [item]) !== undefined)).toHaveLength(
      1,
    );
  });

  it('leaves none of a Laser + CNC machine’s CNC values behind under a CNC preset', () => {
    const hybrid = choose(starter(), 'Neotronics 4040 Max / LT-4LDS-V2 20W');
    const tuned = deviceSetupReducer(hybrid, {
      kind: 'edit-machine',
      machine: { ...hybrid.cncDraft, params: { ...hybrid.cncDraft.params, safeZMm: 9 } },
    });
    const cnc = choose(tuned, 'Genmitsu 3018-PRO');
    expect(cnc.cncDraft.params).toEqual({
      ...DEFAULT_CNC_MACHINE_CONFIG.params,
      spindleMaxRpm: 10000,
    });
    // Tools and stock are the project's, not the listed machine's.
    expect(cnc.cncDraft.tools).toBe(tuned.cncDraft.tools);
  });

  it('turns a listed machine into a custom one that keeps its work area and controller', () => {
    const laser = choose(starter(), 'Creality Falcon A1 Pro (vendor command set)');
    const entries = machinePickerEntries(laser);
    const custom = chooseCustomMachineActions(laser, entries).reduce(deviceSetupReducer, laser);
    expect(custom.draft).toMatchObject({
      profileId: DEFAULT_DEVICE_PROFILE.profileId,
      name: CUSTOM_MACHINE_NAME,
      bedWidth: 358,
      bedHeight: 268,
      controllerKind: 'grblhal',
    });
    expect(custom.draft.controllerCommandSet).toBeUndefined();
    expect(selectedMachineEntry(custom, machinePickerEntries(custom))).toBeUndefined();
    expect(draftIsCustomMachine(custom, machinePickerEntries(custom))).toBe(true);
  });

  it('names the untouched starter when chosen, and leaves a custom draft alone', () => {
    const fresh = starter();
    expect(draftIsCustomMachine(fresh, machinePickerEntries(fresh))).toBe(false);
    const named = chooseCustomMachineActions(fresh, machinePickerEntries(fresh)).reduce(
      deviceSetupReducer,
      fresh,
    );
    // The choice lives in the draft, so it survives leaving the Machine stage.
    expect(named.draft.name).toBe(CUSTOM_MACHINE_NAME);
    expect(named.draft.bedWidth).toBe(DEFAULT_DEVICE_PROFILE.bedWidth);
    expect(draftIsCustomMachine(named, machinePickerEntries(named))).toBe(true);
    const edited = deviceSetupReducer(fresh, { kind: 'edit', patch: { bedWidth: 300 } });
    expect(draftIsCustomMachine(edited, machinePickerEntries(edited))).toBe(true);
    expect(chooseCustomMachineActions(edited, machinePickerEntries(edited))).toEqual([]);
  });
});
