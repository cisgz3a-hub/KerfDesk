import { describe, expect, it } from 'vitest';
import {
  DEVICE_SETUP_CONFIGURED_STORAGE_KEY,
  loadConfiguredSignatures,
  persistConfiguredSignatures,
} from './device-setup-configured-persistence';

function memoryStorage(
  initial: Record<string, string> = {},
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { readonly data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('device-setup configured persistence', () => {
  it('round-trips a set of signatures', () => {
    const storage = memoryStorage();
    persistConfiguredSignatures(storage, new Set(['a:1x1', 'b:2x2']));
    expect([...loadConfiguredSignatures(storage)].sort()).toEqual(['a:1x1', 'b:2x2']);
  });

  it('returns an empty set when nothing is stored', () => {
    expect(loadConfiguredSignatures(memoryStorage()).size).toBe(0);
  });

  it('ignores corrupt or non-array payloads', () => {
    expect(
      loadConfiguredSignatures(memoryStorage({ [DEVICE_SETUP_CONFIGURED_STORAGE_KEY]: 'not json' }))
        .size,
    ).toBe(0);
    expect(
      loadConfiguredSignatures(
        memoryStorage({ [DEVICE_SETUP_CONFIGURED_STORAGE_KEY]: '{"not":"an array"}' }),
      ).size,
    ).toBe(0);
  });

  it('drops non-string entries from a stored array', () => {
    const storage = memoryStorage({
      [DEVICE_SETUP_CONFIGURED_STORAGE_KEY]: JSON.stringify(['ok', 42, null, 'also-ok']),
    });
    expect([...loadConfiguredSignatures(storage)].sort()).toEqual(['also-ok', 'ok']);
  });

  it('reports false when the storage write throws', () => {
    const throwing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(persistConfiguredSignatures(throwing, new Set(['x:1x1']))).toBe(false);
  });
});
