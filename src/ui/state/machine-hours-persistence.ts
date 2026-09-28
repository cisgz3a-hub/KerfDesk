// ADR-502: machine hours live in browser storage, app-level like the Machine
// Setup marks, keyed by the machine's setup signature. Reads validate every
// field and drop what does not fit; reads and writes fail soft, so a quota or
// privacy error only means the hours are not kept.

import {
  MAX_REMINDER_HOURS,
  MIN_REMINDER_HOURS,
  type MachineHoursBook,
  type MachineHoursRecord,
  type MaintenanceReminder,
} from './machine-hours';

export const MACHINE_HOURS_STORAGE_KEY = 'kerfdesk.machine-hours.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadMachineHours(storage: StorageLike): MachineHoursBook {
  let raw: string | null;
  try {
    raw = storage.getItem(MACHINE_HOURS_STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const book: Record<string, MachineHoursRecord> = {};
  for (const [signature, value] of Object.entries(parsed)) {
    const record = parseRecord(value);
    if (record !== null) book[signature] = record;
  }
  return book;
}

export function persistMachineHours(storage: StorageLike, book: MachineHoursBook): boolean {
  try {
    storage.setItem(MACHINE_HOURS_STORAGE_KEY, JSON.stringify(book));
    return true;
  } catch {
    return false;
  }
}

function parseRecord(value: unknown): MachineHoursRecord | null {
  if (!isRecord(value)) return null;
  const { name, runMs, jobs, reminders } = value;
  if (typeof name !== 'string' || !isCount(runMs) || !isCount(jobs) || !Array.isArray(reminders)) {
    return null;
  }
  return {
    name,
    runMs,
    jobs,
    reminders: reminders.flatMap((item) => {
      const reminder = parseReminder(item);
      return reminder === null ? [] : [reminder];
    }),
  };
}

function parseReminder(value: unknown): MaintenanceReminder | null {
  if (!isRecord(value)) return null;
  const { id, label, everyHours, doneAtRunMs } = value;
  if (typeof id !== 'string' || typeof label !== 'string' || label.trim() === '') return null;
  if (
    typeof everyHours !== 'number' ||
    !(everyHours >= MIN_REMINDER_HOURS && everyHours <= MAX_REMINDER_HOURS) ||
    !isCount(doneAtRunMs)
  ) {
    return null;
  }
  return { id, label, everyHours, doneAtRunMs };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
