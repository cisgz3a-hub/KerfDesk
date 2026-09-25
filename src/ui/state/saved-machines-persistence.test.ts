import { describe, expect, it } from 'vitest';
import { everyFieldProfile } from '../../__fixtures__/saved-machines';
import {
  EMPTY_SAVED_MACHINE_LIST,
  addSavedMachine,
  createSavedMachine,
  setDefaultSavedMachine,
} from '../../core/saved-machines/saved-machine-list';
import {
  SAVED_MACHINES_BACKUP_KEY,
  SAVED_MACHINES_STORAGE_KEY,
  persistSavedMachineList,
  restoreSavedMachineList,
} from './saved-machines-persistence';

function memoryStorage(initial: Record<string, string> = {}): {
  readonly values: Map<string, string>;
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const LIST = setDefaultSavedMachine(
  addSavedMachine(
    EMPTY_SAVED_MACHINE_LIST,
    createSavedMachine({
      id: 'router',
      profile: everyFieldProfile(),
      machineKind: 'cnc',
      name: 'Shop 4040',
      now: 1,
    }),
  ),
  'router',
);

describe('saved machine persistence', () => {
  it('writes the list and reads it back exactly', () => {
    const storage = memoryStorage();

    expect(persistSavedMachineList(storage, LIST)).toBe(true);
    expect(restoreSavedMachineList(storage)).toEqual(LIST);
    expect(storage.values.has(SAVED_MACHINES_BACKUP_KEY)).toBe(false);
  });

  it('starts empty when nothing is stored or storage cannot be read', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('denied');
      },
      setItem: (): void => undefined,
    };

    expect(restoreSavedMachineList(memoryStorage())).toBe(EMPTY_SAVED_MACHINE_LIST);
    expect(restoreSavedMachineList(blocked)).toBe(EMPTY_SAVED_MACHINE_LIST);
  });

  it('backs up unreadable text instead of clearing it', () => {
    const storage = memoryStorage({ [SAVED_MACHINES_STORAGE_KEY]: '{"format":"broken' });

    expect(restoreSavedMachineList(storage)).toBe(EMPTY_SAVED_MACHINE_LIST);
    expect(storage.values.get(SAVED_MACHINES_BACKUP_KEY)).toBe('{"format":"broken');
    expect(storage.values.get(SAVED_MACHINES_STORAGE_KEY)).toBe('{"format":"broken');
  });

  it('backs up the stored text when some entries could not be read', () => {
    const stored = JSON.parse(persistedText(LIST)) as { machines: unknown[] };
    const raw = JSON.stringify({ ...stored, machines: [...stored.machines, { id: 'broken' }] });
    const storage = memoryStorage({ [SAVED_MACHINES_STORAGE_KEY]: raw });

    expect(restoreSavedMachineList(storage)).toEqual(LIST);
    expect(storage.values.get(SAVED_MACHINES_BACKUP_KEY)).toBe(raw);
  });

  it('reports a failed write instead of throwing', () => {
    const full = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
    };

    expect(persistSavedMachineList(full, LIST)).toBe(false);
  });
});

function persistedText(list: typeof LIST): string {
  const storage = memoryStorage();
  persistSavedMachineList(storage, list);
  return storage.values.get(SAVED_MACHINES_STORAGE_KEY) ?? '';
}
