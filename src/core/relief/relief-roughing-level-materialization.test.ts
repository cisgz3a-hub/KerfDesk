import { describe, expect, it } from 'vitest';
import {
  assertReliefLevelArrayLength,
  reliefFineLevelCount,
  ReliefLevelArrayMaterializationError,
} from './relief-roughing-level-materialization';

describe('relief level Array representation', () => {
  it('accepts the exact Array domain edge without materializing it', () => {
    expect(() => assertReliefLevelArrayLength(0xffff_ffff)).not.toThrow();
    expect(() => assertReliefLevelArrayLength(0x1_0000_0000)).toThrow(
      ReliefLevelArrayMaterializationError,
    );
  });

  it('counts impossible fine steps without allocating their heights', () => {
    const count = reliefFineLevelCount(0, -0.95, 1e-12);
    expect(count).toBe(0x1_0000_0000);
    expect(() => assertReliefLevelArrayLength(count + 1)).toThrow(/Array length/);
  });

  it('matches the original floating-point predicate on ordinary steps and boundaries', () => {
    for (const top of [0, -0.1, -1, -3]) {
      for (const span of [0.05, 0.3, 0.95, 1.45]) {
        for (const step of [0.01, 0.05, 0.1, 0.3, 1, 2]) {
          const stop = top - span;
          let count = 0;
          while (top - (count + 1) * step > stop) count += 1;
          expect(reliefFineLevelCount(top, stop, step)).toBe(count);
        }
      }
    }
  });
});
