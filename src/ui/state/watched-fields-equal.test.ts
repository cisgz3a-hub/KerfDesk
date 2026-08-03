import { describe, expect, it } from 'vitest';
import { selectWholeState, watchedFieldsEqual } from './watched-fields-equal';

type Sample = {
  readonly project: { readonly id: string };
  readonly cursorMm: { readonly x: number } | null;
  readonly dirty: boolean;
};

function sample(patch: Partial<Sample> = {}): Sample {
  return { project: { id: 'p' }, cursorMm: null, dirty: false, ...patch };
}

describe('watchedFieldsEqual', () => {
  it('treats a change in an unwatched field as equal', () => {
    const equal = watchedFieldsEqual<Sample, 'project' | 'dirty'>(['project', 'dirty']);
    const before = sample();
    const after = { ...before, cursorMm: { x: 12 } };
    expect(equal(before, after)).toBe(true);
  });

  it('treats a change in any watched field as unequal', () => {
    const equal = watchedFieldsEqual<Sample, 'project' | 'dirty'>(['project', 'dirty']);
    const before = sample();
    expect(equal(before, { ...before, project: { id: 'p' } })).toBe(false);
    expect(equal(before, { ...before, dirty: true })).toBe(false);
  });

  it('short-circuits on an identical snapshot', () => {
    const equal = watchedFieldsEqual<Sample, 'project'>(['project']);
    const only = sample();
    expect(equal(only, only)).toBe(true);
  });

  it('returns the state unchanged from the identity selector', () => {
    const only = sample();
    expect(selectWholeState(only)).toBe(only);
  });
});
