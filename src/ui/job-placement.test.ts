import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../core/controllers/grbl';
import { resolveJobPlacement } from './job-placement';

const idleAtMachinePosition = (x: number, y: number): StatusReport => ({
  state: 'Idle',
  subState: null,
  mPos: { x, y, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
});

describe('resolveJobPlacement', () => {
  it('requires an active custom origin before user-origin output', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'user-origin', anchor: 'front-left' },
      { statusReport: idleAtMachinePosition(10, 20), workOriginActive: false, wcoCache: null },
    );

    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.messages.join('\n')).toMatch(/set origin/i);
    }
  });

  it('resolves user-origin output to zero-based job coordinates plus WCO bounds offset', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'user-origin', anchor: 'center' },
      {
        statusReport: idleAtMachinePosition(120, 80),
        workOriginActive: true,
        wcoCache: { x: 120, y: 80, z: 0 },
      },
    );

    expect(resolved).toEqual({
      ok: true,
      jobOrigin: { startFrom: 'user-origin', anchor: 'center' },
      preflightMotionOffset: { x: 120, y: 80 },
    });
  });

  it('resolves current-position output from MPos and WCO into work coordinates', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'current-position', anchor: 'back-right' },
      {
        statusReport: idleAtMachinePosition(150, 90),
        workOriginActive: true,
        wcoCache: { x: 120, y: 80, z: 0 },
      },
    );

    expect(resolved).toEqual({
      ok: true,
      jobOrigin: {
        startFrom: 'current-position',
        anchor: 'back-right',
        currentPosition: { x: 30, y: 10 },
      },
      preflightMotionOffset: { x: 120, y: 80 },
    });
  });
});
