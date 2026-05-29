// Unit coverage for origin-actions.ts. Two action functions write
// exactly one line through the supplied safeWrite; the predicate
// honours an epsilon so floating-point noise from GRBL doesn't
// register as a custom origin.

import { describe, expect, it, vi } from 'vitest';

import { hasCustomOrigin, resetOrigin, setOriginHere } from './origin-actions';

describe('setOriginHere', () => {
  it('writes exactly G92 X0 Y0 with a trailing newline', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await setOriginHere(safeWrite);
    expect(safeWrite).toHaveBeenCalledTimes(1);
    expect(safeWrite).toHaveBeenCalledWith('G92 X0 Y0\n');
  });

  it('awaits the underlying write before resolving', async () => {
    // Wrap in a Box so TS sees a stable assignable type — the
    // resolver is set inside the Promise constructor (which TS
    // analyses as never-runs-after-init by default).
    const box: { resolve: (() => void) | null } = { resolve: null };
    const pending = new Promise<void>((r) => {
      box.resolve = r;
    });
    const safeWrite = vi.fn(() => pending);
    const action = setOriginHere(safeWrite);
    // Hasn't resolved yet.
    let resolved = false;
    void action.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    // Resolve the write, expect the action to finish.
    box.resolve?.();
    await action;
    expect(resolved).toBe(true);
  });
});

describe('resetOrigin', () => {
  it('writes exactly G92.1 with a trailing newline', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await resetOrigin(safeWrite);
    expect(safeWrite).toHaveBeenCalledTimes(1);
    expect(safeWrite).toHaveBeenCalledWith('G92.1\n');
  });
});

describe('hasCustomOrigin', () => {
  it('returns false on a null cache (no WCO frame received yet)', () => {
    expect(hasCustomOrigin(null)).toBe(false);
  });

  it('returns false on an exactly-zero offset', () => {
    expect(hasCustomOrigin({ x: 0, y: 0, z: 0 })).toBe(false);
  });

  it('returns false on a sub-epsilon offset (GRBL float noise)', () => {
    // GRBL reports 3 decimal places; 0.0005 rounds to 0.001 in display
    // but sits inside our 1e-3 epsilon.
    expect(hasCustomOrigin({ x: 0.0005, y: -0.0005, z: 0 })).toBe(false);
  });

  it('returns true when any axis magnitude exceeds epsilon', () => {
    expect(hasCustomOrigin({ x: 10, y: 0, z: 0 })).toBe(true);
    expect(hasCustomOrigin({ x: 0, y: 5, z: 0 })).toBe(true);
    expect(hasCustomOrigin({ x: 0, y: 0, z: 2 })).toBe(true);
  });

  it('treats negative offsets symmetrically', () => {
    expect(hasCustomOrigin({ x: -10, y: -20, z: 0 })).toBe(true);
  });
});
