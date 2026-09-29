import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import {
  LAST_MACHINE_STORAGE_KEY,
  loadLastMachine,
  rememberLastMachine,
} from './last-machine-persistence';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('the last machine saved in Machine Setup (ADR-500)', () => {
  it('comes back as the same profile', () => {
    const storage = memoryStorage();
    expect(loadLastMachine(storage)).toBeNull();
    const custom = { ...FALCON_A1_PRO_GRBLHAL_PROFILE, name: 'Shop Falcon', bedWidth: 350 };
    expect(rememberLastMachine(storage, custom)).toBe(true);
    expect(loadLastMachine(storage)).toEqual(custom);
    rememberLastMachine(storage, DEFAULT_DEVICE_PROFILE);
    expect(loadLastMachine(storage)).toEqual(DEFAULT_DEVICE_PROFILE);
  });

  it('is ignored when the stored text is not a valid machine profile', () => {
    const storage = memoryStorage();
    storage.setItem(LAST_MACHINE_STORAGE_KEY, '{"format":"something-else"}');
    expect(loadLastMachine(storage)).toBeNull();
    storage.setItem(LAST_MACHINE_STORAGE_KEY, 'not json');
    expect(loadLastMachine(storage)).toBeNull();
  });

  it('fails soft when storage refuses', () => {
    const refusing: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(rememberLastMachine(refusing, DEFAULT_DEVICE_PROFILE)).toBe(false);
    expect(loadLastMachine(refusing)).toBeNull();
  });
});
