import { describe, expect, it } from 'vitest';
import { modulo, normalizeDegrees } from '../math/wrap';
import { errorMessage, errorMessageOr, isAbortError, toError } from './error-message';
import {
  finiteNonNegative,
  isDefinedFinitePositive,
  isFiniteNumber,
  isNonNegativeFiniteNumber,
  isNonNegativeInteger,
  isNonNegativeSafeInteger,
  isPositiveFiniteNumber,
  isPositiveInteger,
} from './finite';
import { asRecord, isRecord } from './is-record';
import { isNonEmptyString, numberFromDraft } from './text';
import { uniqueValues } from './unique';

describe('is-record', () => {
  it('accepts plain objects and rejects null, arrays and primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('text')).toBe(false);
    const value = { a: 1 };
    expect(asRecord(value)).toBe(value);
    expect(asRecord([1])).toBeNull();
  });
});

describe('error-message', () => {
  it('reads an Error and turns anything else into text', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(42)).toBe('42');
    const error = new Error('kept');
    expect(toError(error)).toBe(error);
    expect(toError('thrown text').message).toBe('thrown text');
  });

  it('falls back when the Error has no message, or the value is not an Error', () => {
    expect(errorMessageOr(new Error('boom'), 'fallback')).toBe('boom');
    expect(errorMessageOr(new Error('  '), 'fallback')).toBe('fallback');
    expect(errorMessageOr('text', 'fallback')).toBe('fallback');
  });

  it('recognises an abort by name', () => {
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new Error('cancelled'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});

describe('number guards for unknown values', () => {
  it('reject NaN, infinities and non-numbers', () => {
    for (const guard of [
      isFiniteNumber,
      isPositiveFiniteNumber,
      isNonNegativeFiniteNumber,
      isNonNegativeInteger,
      isNonNegativeSafeInteger,
      isPositiveInteger,
    ]) {
      expect(guard(Number.NaN)).toBe(false);
      expect(guard(Infinity)).toBe(false);
      expect(guard('1')).toBe(false);
      expect(guard(null)).toBe(false);
      expect(guard(3)).toBe(true);
    }
  });

  it('draw the line at zero and at whole numbers where their names say', () => {
    expect(isFiniteNumber(-1.5)).toBe(true);
    expect(isPositiveFiniteNumber(0)).toBe(false);
    expect(isNonNegativeFiniteNumber(0)).toBe(true);
    expect(isNonNegativeFiniteNumber(-0.1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isDefinedFinitePositive(undefined)).toBe(false);
    expect(isDefinedFinitePositive(2)).toBe(true);
    expect(finiteNonNegative(-3)).toBe(0);
    expect(finiteNonNegative(Number.NaN)).toBe(0);
    expect(finiteNonNegative(2.5)).toBe(2.5);
  });
});

describe('text, unique and wrap', () => {
  it('treats blank text as empty, and a blank draft as NaN, not zero', () => {
    expect(isNonEmptyString(' a ')).toBe(true);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(1)).toBe(false);
    expect(numberFromDraft('  ')).toBeNaN();
    expect(numberFromDraft(' 2.5 ')).toBe(2.5);
  });

  it('keeps first-seen order when removing repeats', () => {
    expect(uniqueValues(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });

  it('wraps angles into [0, 360) and remainders to a non-negative value', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(720)).toBe(0);
    expect(modulo(-1, 5)).toBe(4);
    expect(modulo(7, 5)).toBe(2);
  });
});
