import { describe, expect, it } from 'vitest';
import {
  deleteUserMacro,
  findUserMacro,
  normalizeUserMacroName,
  saveUserMacro,
  type UserMacroCollection,
} from './user-macro-collection';

const FIRST_MACRO = {
  name: 'Move to park',
  template: 'G0 X{{x}} Y{{y}}',
  createdAt: 10,
  updatedAt: 10,
} as const;

describe('user macro collection', () => {
  it('normalizes a visible name and creates immutable timestamped data', () => {
    const original: UserMacroCollection = [];
    const result = saveUserMacro(original, {
      name: '  Move\t  to   park  ',
      template: 'G0 X{{x}} Y{{y}}',
      now: 10,
    });

    expect(result).toEqual({
      kind: 'ok',
      macro: FIRST_MACRO,
      collection: [FIRST_MACRO],
    });
    expect(original).toEqual([]);
  });

  it.each(['', ' \n\t ', '\u0000', '\u200b', 'Good\u202eName'])(
    'rejects a name without safe visible text %#',
    (name) => {
      expect(saveUserMacro([], { name, template: '$I', now: 1 })).toMatchObject({
        kind: 'invalid-name',
      });
    },
  );

  it('rejects names that collide case-insensitively', () => {
    expect(
      saveUserMacro([FIRST_MACRO], { name: 'move to PARK', template: '$I', now: 20 }),
    ).toMatchObject({ kind: 'duplicate-name', name: 'move to PARK' });
  });

  it('edits and renames by originalName while preserving createdAt', () => {
    const result = saveUserMacro([FIRST_MACRO], {
      originalName: 'MOVE TO PARK',
      name: 'Park X only',
      template: 'G0 X{{x}}',
      now: 20,
    });

    expect(result).toEqual({
      kind: 'ok',
      macro: { name: 'Park X only', template: 'G0 X{{x}}', createdAt: 10, updatedAt: 20 },
      collection: [{ name: 'Park X only', template: 'G0 X{{x}}', createdAt: 10, updatedAt: 20 }],
    });
  });

  it('rejects a rename collision and a missing original macro', () => {
    const collection: UserMacroCollection = [
      FIRST_MACRO,
      { name: 'Read state', template: '$G', createdAt: 11, updatedAt: 11 },
    ];
    expect(
      saveUserMacro(collection, {
        originalName: FIRST_MACRO.name,
        name: 'READ STATE',
        template: '$I',
        now: 20,
      }),
    ).toMatchObject({ kind: 'duplicate-name' });
    expect(
      saveUserMacro(collection, {
        originalName: 'Missing',
        name: 'Missing',
        template: '$I',
        now: 20,
      }),
    ).toMatchObject({ kind: 'not-found', name: 'Missing' });
  });

  it('returns template and timestamp errors without changing the collection', () => {
    expect(
      saveUserMacro([FIRST_MACRO], { name: 'Bad', template: 'G0 X{{x}', now: 20 }),
    ).toMatchObject({
      kind: 'invalid-template',
      error: { kind: 'malformed-placeholder' },
    });
    expect(
      saveUserMacro([FIRST_MACRO], { name: 'Bad', template: '$I', now: Number.NaN }),
    ).toMatchObject({ kind: 'invalid-timestamp' });
    expect(
      saveUserMacro([FIRST_MACRO], {
        originalName: FIRST_MACRO.name,
        name: FIRST_MACRO.name,
        template: '$I',
        now: 9,
      }),
    ).toMatchObject({ kind: 'invalid-timestamp' });
  });

  it('finds and deletes by case-insensitive name without mutating the input', () => {
    const collection: UserMacroCollection = [FIRST_MACRO];
    expect(findUserMacro(collection, 'MOVE TO PARK')).toBe(FIRST_MACRO);
    expect(deleteUserMacro(collection, 'move to park')).toEqual({ kind: 'ok', collection: [] });
    expect(collection).toEqual([FIRST_MACRO]);
    expect(deleteUserMacro(collection, 'missing')).toMatchObject({ kind: 'not-found' });
  });
});

describe('user macro name normalization', () => {
  it('normalizes Unicode and collapses line-separating whitespace to ordinary spaces', () => {
    expect(normalizeUserMacroName('  Cafe\u0301\u2028position  ')).toBe('Caf\u00e9 position');
  });
});
