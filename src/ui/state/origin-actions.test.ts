// Unit coverage for origin-actions.ts. Two action functions write
// exactly one line through the supplied safeWrite; the predicate
// honours an epsilon so floating-point noise from GRBL doesn't
// register as a custom origin.

import { describe, expect, it, vi } from 'vitest';

import {
  clearPersistentOrigin,
  hasCustomOrigin,
  hasCustomXyOrigin,
  releaseMotors,
  resetOrigin,
  setOriginHere,
  setPersistentOriginHere,
  zeroZHere,
} from './origin-actions';

describe('setOriginHere', () => {
  it('atomically selects G54 and sets transient XY zero', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await setOriginHere(safeWrite, true);
    expect(safeWrite).toHaveBeenCalledTimes(1);
    expect(safeWrite).toHaveBeenCalledWith('G54 G92 X0 Y0\n');
  });

  it('keeps the bare G92 command for G92-only controller families', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await setOriginHere(safeWrite);
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
    const action = setOriginHere(safeWrite, true);
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

describe('zeroZHere', () => {
  it('atomically selects G54 and sets transient stock-top Z zero', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await zeroZHere(safeWrite, true);
    expect(safeWrite).toHaveBeenCalledTimes(1);
    expect(safeWrite).toHaveBeenCalledWith('G54 G92 Z0\n');
  });
});

describe('resetOrigin', () => {
  it('atomically selects G54 and clears G92', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await resetOrigin(safeWrite, true);
    expect(safeWrite).toHaveBeenCalledTimes(1);
    expect(safeWrite).toHaveBeenCalledWith('G54 G92.1\n');
  });
});

describe('setPersistentOriginHere', () => {
  it('clears transient G92 before setting the persistent G54 origin', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await setPersistentOriginHere(safeWrite, true);
    expect(safeWrite).toHaveBeenCalledTimes(2);
    expect(safeWrite).toHaveBeenNthCalledWith(1, 'G54 G92.1\n');
    expect(safeWrite).toHaveBeenNthCalledWith(2, 'G10 L20 P1 X0 Y0\n');
  });
});

describe('clearPersistentOrigin', () => {
  it('clears transient G92 before clearing the persistent G54 origin', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await clearPersistentOrigin(safeWrite, true);
    expect(safeWrite).toHaveBeenCalledTimes(2);
    expect(safeWrite).toHaveBeenNthCalledWith(1, 'G54 G92.1\n');
    expect(safeWrite).toHaveBeenNthCalledWith(2, 'G10 L2 P1 X0 Y0\n');
  });
});

describe('releaseMotors', () => {
  it('writes exactly $SLP with a trailing newline', async () => {
    const safeWrite = vi.fn(async () => undefined);
    await releaseMotors(safeWrite);
    expect(safeWrite).toHaveBeenCalledTimes(1);
    expect(safeWrite).toHaveBeenCalledWith('$SLP\n');
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

describe('hasCustomXyOrigin', () => {
  it('does not treat a Z-only touch-off as an XY job origin', () => {
    expect(hasCustomXyOrigin({ x: 0, y: 0, z: 5 })).toBe(false);
  });

  it('recognizes either non-trivial XY offset and ignores float noise', () => {
    expect(hasCustomXyOrigin({ x: 10, y: 0, z: 5 })).toBe(true);
    expect(hasCustomXyOrigin({ x: 0, y: -20, z: 5 })).toBe(true);
    expect(hasCustomXyOrigin({ x: 0.0005, y: -0.0005, z: 5 })).toBe(false);
  });
});
