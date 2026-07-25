import { describe, expect, it } from 'vitest';
import { applySharedGCode, resolveAxisTarget, type CoreMotionModal } from './modal-axes';

const freshModal = (): CoreMotionModal => ({ motion: 0, unitScale: 1, absolute: true });

describe('applySharedGCode', () => {
  it('applies motion, units, and distance words', () => {
    const state = freshModal();
    expect(applySharedGCode(state, 2)).toBe(true);
    expect(state.motion).toBe(2);
    expect(applySharedGCode(state, 20)).toBe(true);
    expect(state.unitScale).toBeCloseTo(25.4, 12);
    expect(applySharedGCode(state, 91)).toBe(true);
    expect(state.absolute).toBe(false);
  });

  it('returns false and mutates nothing for codes outside the shared set', () => {
    const state = freshModal();
    for (const code of [4, 17, 18, 54, 94, 38.2]) {
      expect(applySharedGCode(state, code)).toBe(false);
    }
    expect(state).toEqual(freshModal());
  });
});

describe('resolveAxisTarget', () => {
  it('holds missing axes and scales by units', () => {
    const state: CoreMotionModal = { motion: 1, unitScale: 25.4, absolute: true };
    const target = resolveAxisTarget({ x: 1, y: 2, z: 3 }, new Map([['X', 2]]), state);
    expect(target).toEqual({ x: 50.8, y: 2, z: 3 });
  });

  it('accumulates in relative mode', () => {
    const state: CoreMotionModal = { motion: 1, unitScale: 1, absolute: false };
    const target = resolveAxisTarget(
      { x: 10, y: 0, z: -1 },
      new Map([
        ['X', -4],
        ['Z', -1],
      ]),
      state,
    );
    expect(target).toEqual({ x: 6, y: 0, z: -2 });
  });
});
