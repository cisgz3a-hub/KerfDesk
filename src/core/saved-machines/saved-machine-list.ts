// My machines (ADR-374): complete machine profiles the operator keeps on this
// workstation, outside any project. A project still carries its own full
// DeviceProfile; `DeviceProfile.savedMachineId` only names the entry that copy
// came from. Pure list operations: callers pass ids and timestamps in.

import type { DeviceProfile } from '../devices';
import { explicitMachineKindsForProfile } from '../devices/device-profile';
import { DEFAULT_CNC_MACHINE_PARAMS, type MachineKind } from '../scene';
import type { ControllerFingerprint } from './controller-fingerprint';

export type SavedMachine = {
  readonly id: string;
  readonly name: string;
  /** The complete profile, named like the entry and pointing back at it. */
  readonly profile: DeviceProfile;
  /** The output mode a project uses after switching to this machine. */
  readonly machineKind: MachineKind;
  /** What the controller reported when the operator saved it, if connected. */
  readonly controllerFingerprint?: ControllerFingerprint;
  readonly savedAt: number;
  readonly updatedAt: number;
};

export type SavedMachineList = {
  readonly machines: ReadonlyArray<SavedMachine>;
  /** The machine new projects start with; null keeps the current machine. */
  readonly defaultMachineId: string | null;
};

export const EMPTY_SAVED_MACHINE_LIST: SavedMachineList = { machines: [], defaultMachineId: null };

export const MAX_SAVED_MACHINE_NAME_LENGTH = 120;

export type SavedMachineInput = {
  readonly id: string;
  readonly profile: DeviceProfile;
  readonly machineKind: MachineKind;
  readonly name?: string;
  readonly controllerFingerprint?: ControllerFingerprint | undefined;
  readonly now: number;
};

export function createSavedMachine(input: SavedMachineInput): SavedMachine {
  const name = cleanSavedMachineName(input.name ?? input.profile.name) || 'My machine';
  return {
    id: input.id,
    name,
    profile: savedMachineProfile(input.profile, input.id, name),
    machineKind: savedMachineKind(input.profile, input.machineKind),
    ...(input.controllerFingerprint === undefined
      ? {}
      : { controllerFingerprint: input.controllerFingerprint }),
    savedAt: input.now,
    updatedAt: input.now,
  };
}

/** The entry's own copy of a profile. A machine that can drive a spindle always
 * carries its spindle values, so switching to it never inherits the spindle
 * range, safe Z or park position of whichever machine was open before. */
export function savedMachineProfile(
  profile: DeviceProfile,
  id: string,
  name: string,
): DeviceProfile {
  const needsCncValues =
    profile.capabilities?.includes('cnc-output') === true && profile.cncSubProfile === undefined;
  return {
    ...profile,
    ...(needsCncValues ? { cncSubProfile: { ...DEFAULT_CNC_MACHINE_PARAMS } } : {}),
    name,
    savedMachineId: id,
  };
}

/** A profile that declares its output kinds decides the mode; an undeclared
 * (legacy) profile keeps the requested one. */
export function savedMachineKind(profile: DeviceProfile, requested: MachineKind): MachineKind {
  const explicit = explicitMachineKindsForProfile(profile);
  if (explicit.length === 0 || explicit.includes(requested)) return requested;
  return explicit[0] ?? requested;
}

export function findSavedMachine(
  list: SavedMachineList,
  id: string | undefined,
): SavedMachine | undefined {
  if (id === undefined) return undefined;
  return list.machines.find((machine) => machine.id === id);
}

export function defaultSavedMachine(list: SavedMachineList): SavedMachine | undefined {
  return findSavedMachine(list, list.defaultMachineId ?? undefined);
}

/** Alphabetical, like LightBurn's default Devices ordering. */
export function savedMachinesByName(list: SavedMachineList): ReadonlyArray<SavedMachine> {
  return [...list.machines].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }),
  );
}

export function addSavedMachine(list: SavedMachineList, machine: SavedMachine): SavedMachineList {
  if (findSavedMachine(list, machine.id) !== undefined) return list;
  return { ...list, machines: [...list.machines, machine] };
}

export type SavedMachineProfileUpdate = {
  readonly profile: DeviceProfile;
  readonly machineKind: MachineKind;
  /** undefined keeps the recorded controller; a value replaces it. */
  readonly controllerFingerprint?: ControllerFingerprint | undefined;
  readonly now: number;
};

export function updateSavedMachineProfile(
  list: SavedMachineList,
  id: string,
  update: SavedMachineProfileUpdate,
): SavedMachineList {
  return mapMachine(list, id, (machine) => ({
    ...machine,
    profile: savedMachineProfile(update.profile, machine.id, machine.name),
    machineKind: savedMachineKind(update.profile, update.machineKind),
    ...(update.controllerFingerprint === undefined
      ? {}
      : { controllerFingerprint: update.controllerFingerprint }),
    updatedAt: update.now,
  }));
}

export function renameSavedMachine(
  list: SavedMachineList,
  id: string,
  name: string,
  now: number,
): SavedMachineList {
  const cleaned = cleanSavedMachineName(name);
  if (savedMachineNameIssue(list, cleaned, id) !== null) return list;
  return mapMachine(list, id, (machine) => ({
    ...machine,
    name: cleaned,
    profile: { ...machine.profile, name: cleaned },
    updatedAt: now,
  }));
}

/** LightBurn's Duplicate copies every setting and appends "(Duplicate)" to the
 * name. The copy keeps the recorded controller: it describes the same
 * hardware until the operator saves it from another connection, and two
 * matching entries make the connect notice stay silent rather than guess. */
export function duplicateSavedMachine(
  list: SavedMachineList,
  id: string,
  newId: string,
  now: number,
): SavedMachineList {
  const source = findSavedMachine(list, id);
  if (source === undefined || findSavedMachine(list, newId) !== undefined) return list;
  const name = uniqueSavedMachineName(list, `${source.name} (Duplicate)`);
  return addSavedMachine(list, {
    ...source,
    id: newId,
    name,
    profile: savedMachineProfile(source.profile, newId, name),
    savedAt: now,
    updatedAt: now,
  });
}

export function removeSavedMachine(list: SavedMachineList, id: string): SavedMachineList {
  const machines = list.machines.filter((machine) => machine.id !== id);
  if (machines.length === list.machines.length) return list;
  return {
    machines,
    defaultMachineId: list.defaultMachineId === id ? null : list.defaultMachineId,
  };
}

export function setDefaultSavedMachine(
  list: SavedMachineList,
  id: string | null,
): SavedMachineList {
  if (id !== null && findSavedMachine(list, id) === undefined) return list;
  return list.defaultMachineId === id ? list : { ...list, defaultMachineId: id };
}

/** Add a profile read from a file. Its saved-machine id is kept when free so a
 * project made on another workstation still recognises it; a clash with an
 * existing entry imports a separate copy instead of overwriting it. The file
 * does not say which output a laser-and-spindle machine was used for, so the
 * entry takes the preferred mode when the machine supports it, as a Machine
 * Setup catalog pick does. */
export function importSavedMachine(
  list: SavedMachineList,
  profile: DeviceProfile,
  options: { readonly newId: string; readonly now: number; readonly preferredKind: MachineKind },
): { readonly list: SavedMachineList; readonly machine: SavedMachine } {
  const fileId = profile.savedMachineId;
  const id =
    fileId !== undefined && findSavedMachine(list, fileId) === undefined ? fileId : options.newId;
  const machine = createSavedMachine({
    id,
    profile,
    machineKind: options.preferredKind,
    name: uniqueSavedMachineName(list, cleanSavedMachineName(profile.name) || 'Imported machine'),
    now: options.now,
  });
  return { list: addSavedMachine(list, machine), machine };
}

export function cleanSavedMachineName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_SAVED_MACHINE_NAME_LENGTH);
}

export function savedMachineNameIssue(
  list: SavedMachineList,
  name: string,
  excludeId?: string,
): string | null {
  const cleaned = cleanSavedMachineName(name);
  if (cleaned === '') return 'Enter a name for this machine.';
  const taken = list.machines.find(
    (machine) => machine.id !== excludeId && sameName(machine.name, cleaned),
  );
  return taken === undefined ? null : `Another saved machine is already called “${taken.name}”.`;
}

export function uniqueSavedMachineName(list: SavedMachineList, base: string): string {
  const cleaned = cleanSavedMachineName(base) || 'My machine';
  if (savedMachineNameIssue(list, cleaned) === null) return cleaned;
  // At most one suffix per existing entry can be taken, so this ends by then.
  for (let suffix = 2; ; suffix += 1) {
    const room = MAX_SAVED_MACHINE_NAME_LENGTH - String(suffix).length - 1;
    const candidate = `${cleaned.slice(0, room).trimEnd()} ${suffix}`;
    if (savedMachineNameIssue(list, candidate) === null) return candidate;
  }
}

function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'base' }) === 0;
}

function mapMachine(
  list: SavedMachineList,
  id: string,
  change: (machine: SavedMachine) => SavedMachine,
): SavedMachineList {
  if (findSavedMachine(list, id) === undefined) return list;
  return {
    ...list,
    machines: list.machines.map((machine) => (machine.id === id ? change(machine) : machine)),
  };
}
