// ADR-502: the machine hours book the UI reads, kept in step with browser
// storage. Every change re-reads storage first, so another window's hours are
// not written over.

import { create } from 'zustand';
import type { MachineKind } from '../../core/scene';
import { browserLocalStorage } from './browser-local-storage';
import {
  addRunTime,
  clampReminderHours,
  machineRecord,
  newlyDueReminders,
  updateReminders,
  type MachineHoursBook,
  type MaintenanceReminder,
} from './machine-hours';
import { loadMachineHours, persistMachineHours } from './machine-hours-persistence';

export type HoursMachine = {
  readonly signature: string;
  readonly name: string;
  readonly kind: MachineKind;
};

type MachineHoursStore = {
  readonly book: MachineHoursBook;
  readonly reload: () => void;
  /** Adds measured run time; returns the reminders that fell due with it. */
  readonly addRun: (
    machine: HoursMachine,
    runMs: number,
    jobEnded: boolean,
  ) => ReadonlyArray<MaintenanceReminder>;
  readonly markDone: (machine: HoursMachine, reminderId: string) => void;
  readonly setEveryHours: (machine: HoursMachine, reminderId: string, hours: number) => void;
  readonly removeReminder: (machine: HoursMachine, reminderId: string) => void;
  readonly addReminder: (machine: HoursMachine, label: string, hours: number) => void;
};

function readBook(): MachineHoursBook {
  const storage = browserLocalStorage();
  return storage === null ? {} : loadMachineHours(storage);
}

function writeBook(book: MachineHoursBook): void {
  const storage = browserLocalStorage();
  if (storage !== null) persistMachineHours(storage, book);
}

export const useMachineHoursStore = create<MachineHoursStore>((set) => {
  const change = (next: (book: MachineHoursBook) => MachineHoursBook): void => {
    const book = next(readBook());
    writeBook(book);
    set({ book });
  };
  return {
    book: readBook(),
    reload: () => set({ book: readBook() }),
    addRun: (machine, runMs, jobEnded) => {
      const before = readBook();
      const after = addRunTime(before, machine, runMs, jobEnded);
      if (after === before) return [];
      writeBook(after);
      set({ book: after });
      return newlyDueReminders(
        machineRecord(before, machine.signature, machine.name, machine.kind),
        machineRecord(after, machine.signature, machine.name, machine.kind),
      );
    },
    markDone: (machine, reminderId) =>
      change((book) =>
        updateReminders(book, machine, (reminders, record) =>
          reminders.map((reminder) =>
            reminder.id === reminderId ? { ...reminder, doneAtRunMs: record.runMs } : reminder,
          ),
        ),
      ),
    setEveryHours: (machine, reminderId, hours) => {
      const everyHours = clampReminderHours(hours);
      if (everyHours === null) return;
      change((book) =>
        updateReminders(book, machine, (reminders) =>
          reminders.map((reminder) =>
            reminder.id === reminderId ? { ...reminder, everyHours } : reminder,
          ),
        ),
      );
    },
    removeReminder: (machine, reminderId) =>
      change((book) =>
        updateReminders(book, machine, (reminders) =>
          reminders.filter((reminder) => reminder.id !== reminderId),
        ),
      ),
    addReminder: (machine, label, hours) => {
      const everyHours = clampReminderHours(hours);
      const trimmed = label.trim();
      if (everyHours === null || trimmed === '') return;
      change((book) =>
        updateReminders(book, machine, (reminders, record) => [
          ...reminders,
          { id: uniqueId(reminders), label: trimmed, everyHours, doneAtRunMs: record.runMs },
        ]),
      );
    },
  };
});

function uniqueId(reminders: ReadonlyArray<MaintenanceReminder>): string {
  const taken = new Set(reminders.map((reminder) => reminder.id));
  let index = reminders.length + 1;
  while (taken.has(`custom-${index}`)) index += 1;
  return `custom-${index}`;
}
