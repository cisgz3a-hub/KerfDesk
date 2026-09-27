import { describe, expect, it } from 'vitest';
import {
  INSPECTOR_LOOK_KEY,
  readInspectorLook,
  writeInspectorLook,
} from './inspector-look-preference';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('Inspector look preference', () => {
  it('defaults to Classic and remembers Studio', () => {
    const storage = memoryStorage();
    expect(readInspectorLook(storage)).toBe('classic');
    writeInspectorLook('studio', storage);
    expect(storage.getItem(INSPECTOR_LOOK_KEY)).toBe('studio');
    expect(readInspectorLook(storage)).toBe('studio');
  });

  it('falls back to Classic for unknown values and unavailable storage', () => {
    const storage = memoryStorage();
    storage.setItem(INSPECTOR_LOOK_KEY, 'neon');
    expect(readInspectorLook(storage)).toBe('classic');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readInspectorLook(broken)).toBe('classic');
    expect(() => writeInspectorLook('studio', broken)).not.toThrow();
    expect(readInspectorLook(null)).toBe('classic');
  });
});
