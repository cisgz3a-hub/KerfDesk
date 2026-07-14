import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { ResolvedJobPlacement } from '../job-placement';
import { frameVerificationRequirement } from './frame-verification-policy';

const relativePlacements = [
  {
    mode: 'current-position',
    placement: {
      ok: true,
      jobOrigin: {
        startFrom: 'current-position',
        anchor: 'front-left',
        currentPosition: { x: 20, y: 30 },
      },
    },
  },
  {
    mode: 'user-origin',
    placement: {
      ok: true,
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    },
  },
] as const satisfies ReadonlyArray<{
  readonly mode: string;
  readonly placement: Extract<ResolvedJobPlacement, { readonly ok: true }>;
}>;

describe('frameVerificationRequirement', () => {
  it.each(relativePlacements)('requires a frame for $mode without homing', ({ placement }) => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: false },
    };
    expect(frameVerificationRequirement(device, placement)).toBe('no-homing-relative');
  });

  it.each(relativePlacements)(
    'does not add a relative frame gate for $mode with homing',
    ({ placement }) => {
      const device = {
        ...DEFAULT_DEVICE_PROFILE,
        homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
      };
      expect(frameVerificationRequirement(device, placement)).toBe('none');
    },
  );

  it('always requires a frame for Verified Origin', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };
    const placement: Extract<ResolvedJobPlacement, { readonly ok: true }> = {
      ok: true,
      jobOrigin: { startFrom: 'verified-origin', anchor: 'front-left' },
    };
    expect(frameVerificationRequirement(device, placement)).toBe('verified-origin');
  });

  it('leaves Absolute Coordinates unchanged without homing', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: false },
    };
    expect(frameVerificationRequirement(device, { ok: true })).toBe('none');
  });
});
