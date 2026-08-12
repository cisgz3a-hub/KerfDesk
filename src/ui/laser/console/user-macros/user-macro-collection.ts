import { parseUserMacroTemplate, type UserMacroTemplateError } from './user-macro-template';

const NAME_UNSAFE_CATEGORY_PATTERN = /\p{C}/u;
const VISIBLE_NAME_PATTERN = /[^\s\p{C}]/u;

export type UserMacro = {
  readonly name: string;
  readonly template: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type UserMacroCollection = ReadonlyArray<UserMacro>;

export const EMPTY_USER_MACRO_COLLECTION: UserMacroCollection = [];

export type SaveUserMacroRequest = {
  readonly name: string;
  readonly template: string;
  readonly now: number;
  readonly originalName?: string;
};

export type SaveUserMacroResult =
  | {
      readonly kind: 'ok';
      readonly macro: UserMacro;
      readonly collection: UserMacroCollection;
    }
  | { readonly kind: 'invalid-name'; readonly message: string }
  | { readonly kind: 'invalid-timestamp'; readonly message: string }
  | {
      readonly kind: 'invalid-template';
      readonly error: UserMacroTemplateError;
      readonly message: string;
    }
  | { readonly kind: 'duplicate-name'; readonly name: string; readonly message: string }
  | { readonly kind: 'not-found'; readonly name: string; readonly message: string };

export type DeleteUserMacroResult =
  | { readonly kind: 'ok'; readonly collection: UserMacroCollection }
  | { readonly kind: 'invalid-name'; readonly message: string }
  | { readonly kind: 'not-found'; readonly name: string; readonly message: string };

/** Normalizes a display name while keeping persisted provenance on one visible line. */
export function normalizeUserMacroName(name: string): string | null {
  const normalized = name.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (normalized === '') return null;
  if (NAME_UNSAFE_CATEGORY_PATTERN.test(normalized) || !VISIBLE_NAME_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

/** Creates or edits one macro without mutating or persisting the input collection. */
export function saveUserMacro(
  collection: UserMacroCollection,
  request: SaveUserMacroRequest,
): SaveUserMacroResult {
  const name = normalizeUserMacroName(request.name);
  if (name === null) {
    return { kind: 'invalid-name', message: 'Enter a macro name containing visible text.' };
  }
  if (!isValidTimestamp(request.now)) {
    return { kind: 'invalid-timestamp', message: 'The macro timestamp is invalid.' };
  }
  const template = parseUserMacroTemplate(request.template);
  if (template.kind !== 'ok') {
    return { kind: 'invalid-template', error: template, message: template.message };
  }
  const existing = findOriginalMacro(collection, request.originalName);
  if (request.originalName !== undefined && existing === null) {
    return {
      kind: 'not-found',
      name: request.originalName,
      message: 'The macro no longer exists.',
    };
  }
  if (existing !== null && request.now < existing.createdAt) {
    return { kind: 'invalid-timestamp', message: 'The macro timestamp is invalid.' };
  }
  if (hasNameConflict(collection, name, existing)) {
    return { kind: 'duplicate-name', name, message: `A macro named "${name}" already exists.` };
  }
  const macro: UserMacro = {
    name,
    template: template.template,
    createdAt: existing?.createdAt ?? request.now,
    updatedAt: request.now,
  };
  const nextCollection =
    existing === null
      ? [...collection, macro]
      : collection.map((candidate) => (candidate === existing ? macro : candidate));
  return { kind: 'ok', macro, collection: nextCollection };
}

/** Removes one named macro without mutating or persisting the input collection. */
export function deleteUserMacro(
  collection: UserMacroCollection,
  nameInput: string,
): DeleteUserMacroResult {
  const name = normalizeUserMacroName(nameInput);
  if (name === null) {
    return { kind: 'invalid-name', message: 'Choose a valid macro to delete.' };
  }
  const existing = findUserMacro(collection, name);
  if (existing === null) {
    return { kind: 'not-found', name, message: 'The macro no longer exists.' };
  }
  return { kind: 'ok', collection: collection.filter((macro) => macro !== existing) };
}

export function findUserMacro(collection: UserMacroCollection, name: string): UserMacro | null {
  const key = macroNameKey(name);
  return collection.find((macro) => macroNameKey(macro.name) === key) ?? null;
}

export function macroNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** Returns whether a persisted macro timestamp is finite and non-negative. */
export function isValidTimestamp(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function findOriginalMacro(
  collection: UserMacroCollection,
  originalName: string | undefined,
): UserMacro | null {
  if (originalName === undefined) return null;
  const normalized = normalizeUserMacroName(originalName);
  return normalized === null ? null : findUserMacro(collection, normalized);
}

function hasNameConflict(
  collection: UserMacroCollection,
  name: string,
  editedMacro: UserMacro | null,
): boolean {
  const key = macroNameKey(name);
  return collection.some((macro) => macro !== editedMacro && macroNameKey(macro.name) === key);
}
