import { describe, expect, it } from 'vitest';
import { isValidCncTipAngleDeg } from './cnc-tip-angle';

describe('CNC tip-angle contract', () => {
  it.each([
    [1, true],
    [179, true],
    [0.999, false],
    [179.001, false],
    [Number.NaN, false],
  ])('validates the shared included-angle boundary %s', (angle, expected) => {
    expect(isValidCncTipAngleDeg(angle)).toBe(expected);
  });
});
