import { describe, expect, it } from 'vitest';
import {
  hasEntryLocks,
  lockPolarPoint,
  lockSweepEnd,
  parseEntryValue,
  withEntryLock,
} from './typed-entry';

const ORIGIN = { x: 10, y: 20 };

function close(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('lockPolarPoint', () => {
  it('returns the pointer untouched when nothing is typed', () => {
    const target = { x: 33, y: 44 };
    expect(lockPolarPoint(ORIGIN, target, {})).toBe(target);
  });

  it('keeps the pointer direction and replaces only the length', () => {
    close(lockPolarPoint(ORIGIN, { x: 13, y: 24 }, { lengthMm: 50 }), { x: 40, y: 60 });
  });

  it('lays a typed length along +X when the pointer has no direction yet', () => {
    close(lockPolarPoint(ORIGIN, ORIGIN, { lengthMm: 25 }), { x: 35, y: 20 });
  });

  it('projects the pointer onto a typed angle for the free length', () => {
    close(lockPolarPoint(ORIGIN, { x: 30, y: 99 }, { angleDeg: 0 }), { x: 30, y: 20 });
  });

  it('never lays the free length behind the anchor', () => {
    close(lockPolarPoint(ORIGIN, { x: -5, y: 20 }, { angleDeg: 0 }), ORIGIN);
  });

  it('fixes the point exactly when both are typed, whatever the pointer does', () => {
    const fixed = lockPolarPoint(ORIGIN, { x: -400, y: 7 }, { lengthMm: 10, angleDeg: 90 });
    close(fixed, { x: 10, y: 30 });
  });
});

describe('lockSweepEnd', () => {
  it('turns the start about the centre by the typed sweep', () => {
    close(lockSweepEnd({ x: 0, y: 0 }, { x: 10, y: 0 }, 90), { x: 0, y: 10 });
  });

  it('reads a negative sweep as its counter-clockwise equivalent', () => {
    close(lockSweepEnd({ x: 0, y: 0 }, { x: 10, y: 0 }, -90), { x: 0, y: -10 });
  });
});

describe('parseEntryValue', () => {
  it('accepts maths and units in a length box', () => {
    expect(parseEntryValue('length', '1in')).toEqual({ kind: 'ok', value: 25.4 });
    expect(parseEntryValue('width', '100/4')).toEqual({ kind: 'ok', value: 25 });
  });

  it('refuses a size that draws nothing', () => {
    expect(parseEntryValue('radius', '0').kind).toBe('invalid');
    expect(parseEntryValue('height', '-5').kind).toBe('invalid');
  });

  it('accepts any sign for an angle but not a full turn of sweep', () => {
    expect(parseEntryValue('angle', '-30')).toEqual({ kind: 'ok', value: -30 });
    expect(parseEntryValue('sweep', '360').kind).toBe('invalid');
  });

  it('clears the lock on an empty box and reports junk', () => {
    expect(parseEntryValue('length', '  ')).toEqual({ kind: 'clear' });
    expect(parseEntryValue('length', 'abc').kind).toBe('invalid');
  });
});

describe('withEntryLock', () => {
  it('adds and removes one key without touching the rest', () => {
    const locked = withEntryLock(withEntryLock(undefined, 'length', 5), 'angle', 30);
    expect(locked).toEqual({ length: 5, angle: 30 });
    expect(withEntryLock(locked, 'length', null)).toEqual({ angle: 30 });
    expect(hasEntryLocks(undefined)).toBe(false);
    expect(hasEntryLocks(locked)).toBe(true);
  });
});
