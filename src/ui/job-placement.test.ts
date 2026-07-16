import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../core/devices';
import {
  defaultJobPlacementForDevice,
  jobPlacementAfterDeviceChange,
  jobPlacementAfterProfileSelection,
  resolveJobPlacement,
  trustedMotionOffsetForPreflight,
} from './job-placement';

const idleAtMachinePosition = (x: number, y: number): StatusReport => ({
  state: 'Idle',
  subState: null,
  mPos: { x, y, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
});

describe('profile-aware placement defaults', () => {
  it('defaults no-homing profiles to User Origin so the operator sets origin first', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: false },
    };
    expect(defaultJobPlacementForDevice(device)).toEqual({
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
  });

  it('keeps Absolute Coordinates as the homing-enabled default', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };
    expect(defaultJobPlacementForDevice(device)).toEqual({
      startFrom: 'absolute',
      anchor: 'front-left',
    });
  });

  it('moves an untouched default with a changed device while preserving explicit choices', () => {
    const noHoming = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: false },
    };
    const homing = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };
    expect(
      jobPlacementAfterDeviceChange({ startFrom: 'absolute', anchor: 'center' }, homing, noHoming),
    ).toEqual({ startFrom: 'user-origin', anchor: 'center' });
    expect(
      jobPlacementAfterDeviceChange(
        { startFrom: 'current-position', anchor: 'center' },
        homing,
        noHoming,
      ),
    ).toEqual({ startFrom: 'current-position', anchor: 'center' });
  });

  it('keeps an explicit Current Position choice when a no-homing profile is selected', () => {
    const noHoming = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: false },
    };
    const homing = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };
    expect(
      jobPlacementAfterProfileSelection(
        { startFrom: 'current-position', anchor: 'center' },
        homing,
        noHoming,
      ),
    ).toEqual({ startFrom: 'current-position', anchor: 'center' });
  });

  it('restores Absolute Coordinates when a homing profile is explicitly selected', () => {
    const homing = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };

    expect(
      jobPlacementAfterProfileSelection(
        { startFrom: 'current-position', anchor: 'center' },
        homing,
        homing,
      ),
    ).toEqual({ startFrom: 'absolute', anchor: 'center' });
  });

  it('preserves deliberate origin modes across homing profile selection', () => {
    const homing = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };

    expect(
      jobPlacementAfterProfileSelection(
        { startFrom: 'user-origin', anchor: 'center' },
        homing,
        homing,
      ),
    ).toEqual({ startFrom: 'user-origin', anchor: 'center' });
  });
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

  it('does not accept a Z-only WCO as proof of an XY user origin', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'user-origin', anchor: 'front-left' },
      {
        statusReport: idleAtMachinePosition(10, 20),
        workOriginActive: false,
        wcoCache: { x: 0, y: 0, z: 5 },
      },
    );

    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.messages.join('\n')).toMatch(/set origin/i);
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

  // C7: a WPos-only frame that carries its OWN fresh WCO must use that WCO, not
  // a work-offset cache that a just-applied G92/G10 has left stale. WPos and WCO
  // from the same frame are internally consistent; the cache may lag by a report.
  it('prefers a status frame own fresh WCO over a stale work-offset cache', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'current-position', anchor: 'back-right' },
      {
        statusReport: {
          state: 'Idle',
          subState: null,
          mPos: null,
          wPos: { x: 30, y: 10, z: 0 },
          feed: 0,
          spindle: 0,
          wco: { x: 120, y: 80, z: 0 },
        },
        workOriginActive: true,
        wcoCache: { x: 999, y: 999, z: 0 },
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

  it('normalizes inch-reported MPos and WCO before resolving placement', () => {
    const resolved = resolveJobPlacement(
      { startFrom: 'current-position', anchor: 'front-left' },
      {
        statusReport: idleAtMachinePosition(2, 1.5),
        workOriginActive: true,
        wcoCache: { x: 1, y: 0.5, z: 0 },
        reportInches: true,
      },
    );

    expect(resolved).toMatchObject({
      ok: true,
      jobOrigin: {
        startFrom: 'current-position',
        anchor: 'front-left',
        currentPosition: { x: 25.4 },
      },
      preflightMotionOffset: { x: 25.4, y: 12.7 },
    });
    if (resolved.ok && resolved.jobOrigin?.startFrom === 'current-position') {
      expect(resolved.jobOrigin.currentPosition.y).toBeCloseTo(25.4);
    }
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
