// ADR-502: machine hours and maintenance reminders, per machine. Pure logic:
// no React and no storage.
//
// Hours are measured, not estimated: the wall-clock time a started job spent
// running, without its pauses and tool changes. A job that is stopped part way
// counts the time it ran, because the machine ran it. Frames, jogs and console
// moves are not jobs and are not counted. A reminder falls due when the
// machine has run its interval since it was last marked done.

import type { MachineKind } from '../../core/scene';

export type MaintenanceReminder = {
  readonly id: string;
  readonly label: string;
  readonly everyHours: number;
  /** The machine's run time when it was last done (or when it was added). */
  readonly doneAtRunMs: number;
};

export type MachineHoursRecord = {
  readonly name: string;
  readonly runMs: number;
  readonly jobs: number;
  readonly reminders: ReadonlyArray<MaintenanceReminder>;
};

/** Each machine's record, by its setup signature (device-setup-nudge.ts). */
export type MachineHoursBook = Readonly<Record<string, MachineHoursRecord>>;

export const HOUR_MS = 3_600_000;
export const MIN_REMINDER_HOURS = 0.5;
export const MAX_REMINDER_HOURS = 10_000;

const DEFAULT_REMINDERS: Readonly<Record<MachineKind, ReadonlyArray<[string, string, number]>>> = {
  laser: [
    ['lens', 'Clean the lens and its window', 20],
    ['air', 'Clear the air-assist nozzle and check the fans', 50],
    ['motion', 'Check the belts, wheels and rails', 100],
  ],
  cnc: [
    ['collet', 'Clean the collet and check the bit', 20],
    ['rails', 'Clean and lubricate the rails and lead screws', 50],
    ['spindle', 'Check the spindle mount and belts', 100],
  ],
};

export function newMachineRecord(name: string, kind: MachineKind): MachineHoursRecord {
  return {
    name,
    runMs: 0,
    jobs: 0,
    reminders: DEFAULT_REMINDERS[kind].map(([id, label, everyHours]) => ({
      id,
      label,
      everyHours,
      doneAtRunMs: 0,
    })),
  };
}

export function machineRecord(
  book: MachineHoursBook,
  signature: string,
  name: string,
  kind: MachineKind,
): MachineHoursRecord {
  return book[signature] ?? newMachineRecord(name, kind);
}

/** Adds measured run time, and a job when one has ended. */
export function addRunTime(
  book: MachineHoursBook,
  machine: { readonly signature: string; readonly name: string; readonly kind: MachineKind },
  runMs: number,
  jobEnded: boolean,
): MachineHoursBook {
  const added = Number.isFinite(runMs) && runMs > 0 ? runMs : 0;
  if (added === 0 && !jobEnded) return book;
  const record = machineRecord(book, machine.signature, machine.name, machine.kind);
  return {
    ...book,
    [machine.signature]: {
      ...record,
      name: machine.name,
      runMs: record.runMs + added,
      jobs: record.jobs + (jobEnded ? 1 : 0),
    },
  };
}

export function updateReminders(
  book: MachineHoursBook,
  machine: { readonly signature: string; readonly name: string; readonly kind: MachineKind },
  change: (
    reminders: ReadonlyArray<MaintenanceReminder>,
    record: MachineHoursRecord,
  ) => ReadonlyArray<MaintenanceReminder>,
): MachineHoursBook {
  const record = machineRecord(book, machine.signature, machine.name, machine.kind);
  return {
    ...book,
    [machine.signature]: { ...record, reminders: change(record.reminders, record) },
  };
}

/** Hours until due; zero or less means due, by that many hours over. */
export function hoursUntilDue(record: MachineHoursRecord, reminder: MaintenanceReminder): number {
  return reminder.everyHours - (record.runMs - reminder.doneAtRunMs) / HOUR_MS;
}

export function dueReminders(record: MachineHoursRecord): ReadonlyArray<MaintenanceReminder> {
  return record.reminders.filter((reminder) => hoursUntilDue(record, reminder) <= 0);
}

/** Reminders that fell due between two run times: the ones to announce. */
export function newlyDueReminders(
  before: MachineHoursRecord,
  after: MachineHoursRecord,
): ReadonlyArray<MaintenanceReminder> {
  const wasDue = new Set(dueReminders(before).map((reminder) => reminder.id));
  return dueReminders(after).filter((reminder) => !wasDue.has(reminder.id));
}

export function clampReminderHours(hours: number): number | null {
  if (!Number.isFinite(hours)) return null;
  return Math.min(MAX_REMINDER_HOURS, Math.max(MIN_REMINDER_HOURS, hours));
}

export function formatHours(ms: number): string {
  const hours = ms / HOUR_MS;
  if (hours < 10) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours).toLocaleString('en-US')} h`;
}
