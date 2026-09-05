import { describe, expect, it } from 'vitest';
import { effectiveGcodeFeedMmPerMin, formatGcodeFeedMmPerMin } from './feed-word';

describe('effectiveGcodeFeedMmPerMin', () => {
  it.each([
    [1000.6, 1000],
    [1, 1],
    [0.75, 0.75],
    [0, 1],
  ])('maps %s mm/min to the represented feed %s', (requested, expected) => {
    expect(effectiveGcodeFeedMmPerMin(requested)).toBe(expected);
  });

  it.each([
    [0.75, '0.75'],
    [1e-7, '0.0000001'],
    [1e21, '1000000000000000000000'],
  ])('formats %s without exponent notation as %s', (requested, expected) => {
    expect(formatGcodeFeedMmPerMin(requested)).toBe(expected);
  });
});
