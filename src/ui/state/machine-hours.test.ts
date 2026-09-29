import { describe, expect, it } from 'vitest';
import {
  addRunTime,
  dueReminders,
  formatHours,
  HOUR_MS,
  hoursUntilDue,
  machineRecord,
  newlyDueReminders,
} from './machine-hours';
import {
  loadMachineHours,
  MACHINE_HOURS_STORAGE_KEY,
  persistMachineHours,
} from './machine-hours-persistence';

const FALCON = { signature: 'falcon:358x268:grbl', name: 'Falcon A1 Pro', kind: 'laser' as const };

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('machine hours (ADR-502)', () => {
  it('adds run time and jobs per machine, with laser reminders to start', () => {
    let book = addRunTime({}, FALCON, 2 * HOUR_MS, false);
    book = addRunTime(book, FALCON, HOUR_MS / 2, true);
    const record = machineRecord(book, FALCON.signature, FALCON.name, 'laser');
    expect(record).toMatchObject({ name: 'Falcon A1 Pro', runMs: 2.5 * HOUR_MS, jobs: 1 });
    expect(record.reminders.map((reminder) => reminder.everyHours)).toEqual([20, 50, 100]);
    expect(addRunTime(book, FALCON, 0, false)).toBe(book);
    expect(addRunTime(book, FALCON, Number.NaN, false)).toBe(book);
  });

  it('keeps CNC machines apart, with their own reminders', () => {
    const cnc = { signature: 'falcon:358x268:grbl:cnc', name: 'Router', kind: 'cnc' as const };
    const book = addRunTime({}, cnc, HOUR_MS, true);
    expect(machineRecord(book, cnc.signature, cnc.name, 'cnc').reminders[0]?.label).toBe(
      'Clean the collet and check the bit',
    );
    expect(machineRecord(book, FALCON.signature, FALCON.name, 'laser').runMs).toBe(0);
  });

  it('falls due after its interval, and says so once', () => {
    const before = machineRecord(
      addRunTime({}, FALCON, 19 * HOUR_MS, false),
      FALCON.signature,
      '',
      'laser',
    );
    const lens = before.reminders[0];
    if (lens === undefined) throw new Error('lens reminder missing');
    expect(hoursUntilDue(before, lens)).toBeCloseTo(1);
    const after = { ...before, runMs: 21 * HOUR_MS };
    expect(dueReminders(after).map((reminder) => reminder.id)).toEqual(['lens']);
    expect(newlyDueReminders(before, after).map((reminder) => reminder.id)).toEqual(['lens']);
    expect(newlyDueReminders(after, { ...after, runMs: 22 * HOUR_MS })).toEqual([]);
  });

  it('keeps the hours in storage and drops what does not fit', () => {
    const storage = memoryStorage();
    const book = addRunTime({}, FALCON, HOUR_MS, true);
    expect(persistMachineHours(storage, book)).toBe(true);
    expect(loadMachineHours(storage)).toEqual(book);
    storage.setItem(
      MACHINE_HOURS_STORAGE_KEY,
      JSON.stringify({
        good: {
          name: 'Good',
          runMs: 5,
          jobs: 1,
          reminders: [{ id: 'a', label: 'A', everyHours: -1, doneAtRunMs: 0 }],
        },
        bad: { name: 'Bad', runMs: -5, jobs: 1, reminders: [] },
      }),
    );
    expect(loadMachineHours(storage)).toEqual({
      good: { name: 'Good', runMs: 5, jobs: 1, reminders: [] },
    });
    storage.setItem(MACHINE_HOURS_STORAGE_KEY, 'not json');
    expect(loadMachineHours(storage)).toEqual({});
  });

  it('writes hours the way the panel shows them', () => {
    expect(formatHours(0)).toBe('0.0 h');
    expect(formatHours(2.25 * HOUR_MS)).toBe('2.3 h');
    expect(formatHours(1234 * HOUR_MS)).toBe('1,234 h');
  });
});
