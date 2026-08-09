import { describe, expect, it } from 'vitest';
import { square } from '../../__fixtures__/square';
import { fillHatching, fillHatchingExactWithBudget } from './fill-hatching';

describe('fillHatchingExactWithBudget', () => {
  it('is byte-equivalent to the legacy path at ordinary spacing', () => {
    const input = {
      polylines: [square(1)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.1,
    } as const;
    const legacy = fillHatching(input);
    const exact = fillHatchingExactWithBudget(input, 100);

    expect(exact.passLimited).toBe(false);
    expect(exact.hatches).toEqual(legacy);
  });

  it('keeps exact positive spacing below the legacy floor and reports its budget', () => {
    const exact = fillHatchingExactWithBudget(
      {
        polylines: [square(1)],
        hatchAngleDeg: 0,
        hatchSpacingMm: 0.01,
      },
      8,
    );

    expect(exact.hatches).toHaveLength(8);
    expect(exact.passLimited).toBe(true);
    expect(
      (exact.hatches[1]?.points[0]?.y ?? 0) - (exact.hatches[0]?.points[0]?.y ?? 0),
    ).toBeCloseTo(0.01, 12);
  });

  it('does not count an aligned half-open top boundary as budget exhaustion', () => {
    const input = {
      polylines: [square(1)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.25,
    } as const;
    const exactBudget = fillHatchingExactWithBudget(input, 4);
    const largerBudget = fillHatchingExactWithBudget(input, 100);

    expect(exactBudget.hatches).toHaveLength(4);
    expect(exactBudget.hatches).toEqual(largerBudget.hatches);
    expect(exactBudget.passLimited).toBe(false);
    expect(fillHatchingExactWithBudget(input, 3).passLimited).toBe(true);
  });
});
