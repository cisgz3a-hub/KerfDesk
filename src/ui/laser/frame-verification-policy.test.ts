import { describe, expect, it } from 'vitest';
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
  it.each(relativePlacements)('does not require a frame for $mode', ({ placement }) => {
    expect(frameVerificationRequirement(placement)).toBe('none');
  });

  it('always requires a frame for Verified Origin', () => {
    const placement: Extract<ResolvedJobPlacement, { readonly ok: true }> = {
      ok: true,
      jobOrigin: { startFrom: 'verified-origin', anchor: 'front-left' },
    };
    expect(frameVerificationRequirement(placement)).toBe('verified-origin');
  });

  it('leaves Absolute Coordinates unchanged without homing', () => {
    expect(frameVerificationRequirement({ ok: true })).toBe('none');
  });
});
