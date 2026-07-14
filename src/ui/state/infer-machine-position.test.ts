import { describe, expect, it } from 'vitest';
import { currentWorkZMm, inferCurrentMachinePosition } from './infer-machine-position';

describe('currentWorkZMm', () => {
  it('reads WPos.z directly when reported', () => {
    expect(currentWorkZMm({ wPos: { x: 1, y: 2, z: 7.5 }, mPos: null }, null)).toBe(7.5);
  });

  it('derives work Z from MPos.z minus the cached work offset', () => {
    expect(
      currentWorkZMm({ wPos: null, mPos: { x: 0, y: 0, z: -10 } }, { x: 0, y: 0, z: -30 }),
    ).toBe(20);
  });

  it('is unknowable from MPos without a cached offset, or with no report', () => {
    expect(currentWorkZMm({ wPos: null, mPos: { x: 0, y: 0, z: -10 } }, null)).toBeNull();
    expect(currentWorkZMm(null, { x: 0, y: 0, z: -30 })).toBeNull();
  });
});

describe('inferCurrentMachinePosition', () => {
  it('prefers MPos when reported', () => {
    expect(
      inferCurrentMachinePosition({ mPos: { x: 5, y: 6, z: 7 }, wPos: null } as never, {
        x: 1,
        y: 1,
        z: 1,
      }),
    ).toEqual({ x: 5, y: 6, z: 7 });
  });

  it('derives machine position from WPos plus the cached offset', () => {
    expect(
      inferCurrentMachinePosition({ mPos: null, wPos: { x: 0, y: 0, z: -10 } } as never, {
        x: 2,
        y: 3,
        z: -30,
      }),
    ).toEqual({ x: 2, y: 3, z: -40 });
  });
});
