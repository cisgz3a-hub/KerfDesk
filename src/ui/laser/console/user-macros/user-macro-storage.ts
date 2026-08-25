import {
  EMPTY_USER_MACRO_COLLECTION,
  isValidUserMacroTimestamp,
  macroNameKey,
  normalizeUserMacroName,
  type UserMacro,
  type UserMacroCollection,
} from './user-macro-collection';
import { parseUserMacroTemplate } from './user-macro-template';

export const USER_MACRO_STORAGE_KEY = 'curvedesk.console.user-macros.v1';
export const USER_MACRO_SCHEMA_VERSION = 1;

export type UserMacroStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type UserMacroWriteResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'invalid-collection'; readonly message: string }
  | { readonly kind: 'failed'; readonly error: unknown };

type UserMacroEnvelope = {
  readonly schemaVersion: number;
  readonly macros: ReadonlyArray<UserMacro>;
};

/** Restores valid records and ignores a corrupt slot or malformed siblings. */
export function readUserMacros(
  storage: UserMacroStorage | null = browserLocalStorage(),
): UserMacroCollection {
  if (storage === null) return EMPTY_USER_MACRO_COLLECTION;
  let raw: string | null;
  try {
    raw = storage.getItem(USER_MACRO_STORAGE_KEY);
  } catch {
    return EMPTY_USER_MACRO_COLLECTION;
  }
  if (raw === null) return EMPTY_USER_MACRO_COLLECTION;
  const stored = parseEnvelope(raw);
  return stored === null ? EMPTY_USER_MACRO_COLLECTION : validStoredMacros(stored);
}

/** Writes the complete versioned collection in one localStorage operation. */
export function writeUserMacros(
  collection: UserMacroCollection,
  storage: UserMacroStorage | null = browserLocalStorage(),
): UserMacroWriteResult {
  if (storage === null) return { kind: 'unavailable' };
  const canonical = canonicalCollection(collection);
  if (canonical === null) {
    return {
      kind: 'invalid-collection',
      message: 'The user macro collection contains invalid or duplicate records.',
    };
  }
  const envelope: UserMacroEnvelope = {
    schemaVersion: USER_MACRO_SCHEMA_VERSION,
    macros: canonical,
  };
  try {
    storage.setItem(USER_MACRO_STORAGE_KEY, JSON.stringify(envelope));
    return { kind: 'ok' };
  } catch (error) {
    return { kind: 'failed', error };
  }
}

function browserLocalStorage(): UserMacroStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function parseEnvelope(raw: string): ReadonlyArray<unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed['schemaVersion'] !== USER_MACRO_SCHEMA_VERSION) return null;
  return Array.isArray(parsed['macros']) ? parsed['macros'] : null;
}

function validStoredMacros(values: ReadonlyArray<unknown>): UserMacroCollection {
  let collection: UserMacroCollection = [];
  for (const value of values) {
    const macro = parseStoredMacro(value);
    if (macro === null || hasDuplicateName(collection, macro.name)) continue;
    collection = [...collection, macro];
  }
  return collection;
}

function canonicalCollection(collection: UserMacroCollection): UserMacroCollection | null {
  let canonical: UserMacroCollection = [];
  for (const value of collection) {
    const macro = parseStoredMacro(value);
    if (macro === null || hasDuplicateName(canonical, macro.name)) return null;
    canonical = [...canonical, macro];
  }
  return canonical;
}

function parseStoredMacro(value: unknown): UserMacro | null {
  if (!isRecord(value)) return null;
  const name = value['name'];
  const template = value['template'];
  const createdAt = value['createdAt'];
  const updatedAt = value['updatedAt'];
  if (typeof name !== 'string' || normalizeUserMacroName(name) !== name) return null;
  if (typeof template !== 'string' || parseUserMacroTemplate(template).kind !== 'ok') return null;
  if (typeof createdAt !== 'number' || !isValidUserMacroTimestamp(createdAt)) return null;
  if (typeof updatedAt !== 'number' || !isValidUserMacroTimestamp(updatedAt)) return null;
  if (updatedAt < createdAt) return null;
  return { name, template, createdAt, updatedAt };
}

function hasDuplicateName(collection: UserMacroCollection, name: string): boolean {
  const key = macroNameKey(name);
  return collection.some((macro) => macroNameKey(macro.name) === key);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
