import { describe, expect, it } from 'vitest';
import { type UserMacroCollection } from './user-macro-collection';
import {
  readUserMacros,
  USER_MACRO_SCHEMA_VERSION,
  USER_MACRO_STORAGE_KEY,
  writeUserMacros,
  type UserMacroStorage,
} from './user-macro-storage';

const MACROS: UserMacroCollection = [
  { name: 'Read state', template: '$G', createdAt: 10, updatedAt: 10 },
  { name: 'Move X', template: 'G0 X{{x}}', createdAt: 20, updatedAt: 30 },
];

function memoryStorage(
  initial?: string,
): UserMacroStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(USER_MACRO_STORAGE_KEY, initial);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('user macro persistence', () => {
  it('round-trips the collection in a versioned CurveDesk slot', () => {
    const storage = memoryStorage();

    expect(writeUserMacros(MACROS, storage)).toEqual({ kind: 'ok' });
    expect(JSON.parse(storage.data.get(USER_MACRO_STORAGE_KEY) ?? '')).toEqual({
      schemaVersion: USER_MACRO_SCHEMA_VERSION,
      macros: MACROS,
    });
    expect(readUserMacros(storage)).toEqual(MACROS);
  });

  it.each([
    '{not json',
    JSON.stringify([]),
    JSON.stringify({ schemaVersion: 2, macros: MACROS }),
    JSON.stringify({ schemaVersion: USER_MACRO_SCHEMA_VERSION, macros: null }),
  ])('fails soft for a corrupt or unsupported envelope %#', (raw) => {
    expect(readUserMacros(memoryStorage(raw))).toEqual([]);
  });

  it('keeps valid siblings while ignoring malformed records and later duplicate names', () => {
    const raw = JSON.stringify({
      schemaVersion: USER_MACRO_SCHEMA_VERSION,
      macros: [
        MACROS[0],
        { name: 'Bad time', template: '$I', createdAt: -1, updatedAt: 1 },
        { name: 'Backwards time', template: '$I', createdAt: 2, updatedAt: 1 },
        { name: 'Bad template', template: 'G0\tX1', createdAt: 1, updatedAt: 1 },
        { name: 'Bad\u0000name', template: '$I', createdAt: 1, updatedAt: 1 },
        { name: 'Good\u202eName', template: '$I', createdAt: 1, updatedAt: 1 },
        { name: 'READ STATE', template: '$I', createdAt: 40, updatedAt: 40 },
        MACROS[1],
      ],
    });

    expect(readUserMacros(memoryStorage(raw))).toEqual(MACROS);
  });

  it('rejects a partially invalid collection instead of persisting a partial update', () => {
    const storage = memoryStorage('last-persisted-value');
    const invalid: UserMacroCollection = [
      ...MACROS,
      { name: 'Bad', template: 'G0 X{{x}', createdAt: 1, updatedAt: 1 },
    ];

    expect(writeUserMacros(invalid, storage)).toMatchObject({ kind: 'invalid-collection' });
    expect(storage.data.get(USER_MACRO_STORAGE_KEY)).toBe('last-persisted-value');
  });

  it('rejects case-insensitive duplicate names without changing storage', () => {
    const storage = memoryStorage('last-persisted-value');
    const duplicate: UserMacroCollection = [
      ...MACROS,
      { name: 'READ STATE', template: '$I', createdAt: 40, updatedAt: 40 },
    ];

    expect(writeUserMacros(duplicate, storage)).toMatchObject({ kind: 'invalid-collection' });
    expect(storage.data.get(USER_MACRO_STORAGE_KEY)).toBe('last-persisted-value');
  });

  it('reports unavailable and failed writes without claiming a collection change', () => {
    expect(writeUserMacros(MACROS, null)).toEqual({ kind: 'unavailable' });
    const error = new Error('quota');
    const throwing: UserMacroStorage = {
      getItem: () => null,
      setItem: () => {
        throw error;
      },
    };
    expect(writeUserMacros(MACROS, throwing)).toEqual({ kind: 'failed', error });
  });

  it('returns an empty collection when reading storage throws', () => {
    const throwing: UserMacroStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(readUserMacros(throwing)).toEqual([]);
  });
});
