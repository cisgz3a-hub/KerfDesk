import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../core/devices';
import { resolveJobPlacement, trustedMotionOffsetForPreflight } from './job-placement';

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

describe('verified-origin placement (ADR-053)', () => {
  it('requires an active custom origin', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'verified-origin', anchor: 'front-left' },
      { statusReport: idleAtMachinePosition(10, 20), workOriginActive: false, wcoCache: null },
    );

    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.messages.join('\n')).toMatch(/set origin/i);
    }
  });

  it('resolves to a relative placement with NO motion offset (position-untrusted)', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'verified-origin', anchor: 'center' },
      {
        statusReport: idleAtMachinePosition(120, 80),
        workOriginActive: true,
        wcoCache: { x: 120, y: 80, z: 0 },
      },
    );

    expect(resolved).toEqual({
      ok: true,
      jobOrigin: { startFrom: 'verified-origin', anchor: 'center' },
    });
  });

  it('does not require a known WCO (unlike user-origin, which errors here)', () => {
    const machine = {
      statusReport: idleAtMachinePosition(0, -90),
      workOriginActive: true,
      wcoCache: null,
    };
    expect(
      resolveJobPlacement({ startFrom: 'verified-origin', anchor: 'front-left' }, machine).ok,
    ).toBe(true);
    expect(
      resolveJobPlacement({ startFrom: 'user-origin', anchor: 'front-left' }, machine).ok,
    ).toBe(false);
  });
});

describe('trustedMotionOffsetForPreflight', () => {
  const homed = {
    ...DEFAULT_DEVICE_PROFILE,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
  };
  const customOrigin = {
    statusReport: idleAtMachinePosition(120, 80),
    workOriginActive: true,
    wcoCache: { x: 120, y: 80, z: 0 },
  };

  it('never trusts an offset for verified-origin, even with homing enabled', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'verified-origin', anchor: 'front-left' },
      customOrigin,
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(trustedMotionOffsetForPreflight(homed, resolved)).toBeUndefined();
    }
  });

  it('trusts the user-origin offset when homing is enabled', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'user-origin', anchor: 'front-left' },
      customOrigin,
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(trustedMotionOffsetForPreflight(homed, resolved)).toEqual({ x: 120, y: 80 });
    }
  });

  it('does not trust the user-origin offset when homing is disabled', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'user-origin', anchor: 'front-left' },
      customOrigin,
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(trustedMotionOffsetForPreflight(DEFAULT_DEVICE_PROFILE, resolved)).toBeUndefined();
    }
  });
});
