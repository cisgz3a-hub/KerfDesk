// Storage format for My machines (ADR-374). Each entry embeds a complete
// `.lfmachine.json` machine-profile document, so the list reuses that format's
// validation and canonical form; the envelope adds only the entry's id, name,
// output mode, recorded controller and timestamps.

import {
  cleanSavedMachineName,
  savedMachineKind,
  savedMachineProfile,
  type SavedMachine,
  type SavedMachineList,
} from '../../core/saved-machines/saved-machine-list';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
  type MachineProfileDocument,
} from '../machine-profile';
import { parseControllerFingerprint } from './controller-fingerprint-shape';

export const SAVED_MACHINE_LIST_FORMAT = 'laserforge-saved-machines';
export const SAVED_MACHINE_LIST_SCHEMA_VERSION = 1;

const MAX_ID_LENGTH = 200;

export type DeserializeSavedMachineListResult =
  | {
      readonly kind: 'ok';
      readonly list: SavedMachineList;
      /** Entries that could not be read and were left out. */
      readonly droppedEntries: number;
    }
  | { readonly kind: 'invalid'; readonly reason: string };

export function serializeSavedMachineList(list: SavedMachineList): string {
  return `${JSON.stringify({
    format: SAVED_MACHINE_LIST_FORMAT,
    schemaVersion: SAVED_MACHINE_LIST_SCHEMA_VERSION,
    defaultMachineId: list.defaultMachineId,
    machines: list.machines.map(serializedEntry),
  })}\n`;
}

/** One saved machine as a `.lfmachine.json` document, for export and storage. */
export function savedMachineProfileDocument(machine: SavedMachine): MachineProfileDocument {
  const profile = machine.profile;
  return {
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile,
    source: {
      kind: profile.profileSource ?? 'custom',
      label: machine.name,
      ...(profile.catalogVersion === undefined ? {} : { catalogVersion: profile.catalogVersion }),
    },
    reviewNotes: profile.evidence?.map((item) => item.note) ?? [],
  };
}

export function deserializeSavedMachineList(text: string): DeserializeSavedMachineListResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'invalid', reason: `not valid JSON: ${message}` };
  }
  if (!isRecord(raw) || raw['format'] !== SAVED_MACHINE_LIST_FORMAT) {
    return { kind: 'invalid', reason: 'not a saved machine list' };
  }
  if (raw['schemaVersion'] !== SAVED_MACHINE_LIST_SCHEMA_VERSION) {
    return { kind: 'invalid', reason: 'unsupported saved machine list version' };
  }
  const entries = raw['machines'];
  if (!Array.isArray(entries)) return { kind: 'invalid', reason: 'machines must be an array' };
  const machines = readableEntries(entries);
  return {
    kind: 'ok',
    list: { machines, defaultMachineId: defaultMachineIdFor(raw['defaultMachineId'], machines) },
    droppedEntries: entries.length - machines.length,
  };
}

function serializedEntry(machine: SavedMachine): Record<string, unknown> {
  const document: unknown = JSON.parse(
    serializeMachineProfileDocument(savedMachineProfileDocument(machine)),
  );
  return {
    id: machine.id,
    name: machine.name,
    machineKind: machine.machineKind,
    savedAt: machine.savedAt,
    updatedAt: machine.updatedAt,
    ...(machine.controllerFingerprint === undefined
      ? {}
      : { controllerFingerprint: machine.controllerFingerprint }),
    document,
  };
}

function readableEntries(entries: ReadonlyArray<unknown>): ReadonlyArray<SavedMachine> {
  const machines: SavedMachine[] = [];
  for (const entry of entries) {
    const machine = parseEntry(entry);
    if (machine !== null && !machines.some((kept) => kept.id === machine.id)) {
      machines.push(machine);
    }
  }
  return machines;
}

function parseEntry(value: unknown): SavedMachine | null {
  if (!isRecord(value)) return null;
  const header = parseHeader(value);
  if (header === null) return null;
  const document = deserializeMachineProfileDocument(JSON.stringify(value['document'] ?? null), {
    provenance: 'workstation',
  });
  if (document.kind !== 'ok') return null;
  const fingerprint =
    value['controllerFingerprint'] === undefined
      ? null
      : parseControllerFingerprint(value['controllerFingerprint']);
  const profile = document.document.profile;
  return {
    ...header,
    profile: savedMachineProfile(profile, header.id, header.name),
    machineKind: savedMachineKind(profile, header.machineKind),
    ...(fingerprint === null ? {} : { controllerFingerprint: fingerprint }),
  };
}

function parseHeader(
  value: Record<string, unknown>,
): Pick<SavedMachine, 'id' | 'name' | 'machineKind' | 'savedAt' | 'updatedAt'> | null {
  const id = value['id'];
  const name = typeof value['name'] === 'string' ? cleanSavedMachineName(value['name']) : '';
  const machineKind = value['machineKind'];
  const savedAt = value['savedAt'];
  const updatedAt = value['updatedAt'];
  if (typeof id !== 'string' || id.trim() === '' || id.length > MAX_ID_LENGTH || name === '') {
    return null;
  }
  if (machineKind !== 'laser' && machineKind !== 'cnc') return null;
  if (!isTimestamp(savedAt) || !isTimestamp(updatedAt)) return null;
  return { id, name, machineKind, savedAt, updatedAt };
}

function defaultMachineIdFor(value: unknown, machines: ReadonlyArray<SavedMachine>): string | null {
  return typeof value === 'string' && machines.some((machine) => machine.id === value)
    ? value
    : null;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
