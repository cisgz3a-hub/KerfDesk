// CNC audit v3 N5-P1-1 (ADR-215 Amendment 3): the Work Z record a reset
// voided, kept for CNC pass recovery.

import { describe, expect, it } from 'vitest';
import { originUnknownAfterControllerReset } from './laser-status-line';
import { useLaserStore, type LaserState } from './laser-store';
import { currentWorkZBeforeReset, workZBeforeResetPatch } from './work-z-before-reset';
import { captureWorkZZeroEvidence } from './work-z-zero-evidence';

function zeroedWith(
  source: 'manual-zero' | 'probe',
  overrides: Partial<LaserState> = {},
): LaserState {
  const base = useLaserStore.getState();
  return {
    ...base,
    workZReferenceEpoch: 4,
    workZZeroEvidence: captureWorkZZeroEvidence(source, 4, 'em-6350'),
    ...overrides,
  };
}

describe('the Work Z record a reset voids', () => {
  it('marks a Zero Z (G92) cleared on stock GRBL and FluidNC', () => {
    for (const activeControllerKind of ['grbl-v1.1', 'fluidnc'] as const) {
      const after = originUnknownAfterControllerReset(
        zeroedWith('manual-zero', { activeControllerKind }),
      );
      expect(after.workZZeroEvidence).toBeNull();
      expect(after.workZBeforeReset).toMatchObject({
        zeroCommand: 'g92',
        g92Cleared: true,
        referenceEpoch: 5,
        evidence: { toolId: 'em-6350', source: 'manual-zero' },
      });
    }
  });

  it("keeps grblHAL's G92 and every probed work offset", () => {
    const grblhal = originUnknownAfterControllerReset(
      zeroedWith('manual-zero', { activeControllerKind: 'grblhal' }),
    );
    expect(grblhal.workZBeforeReset).toMatchObject({ zeroCommand: 'g92', g92Cleared: false });
    const detected = originUnknownAfterControllerReset(
      zeroedWith('manual-zero', { detectedControllerKind: 'grblhal' }),
    );
    expect(detected.workZBeforeReset?.g92Cleared).toBe(false);
    const probed = originUnknownAfterControllerReset(zeroedWith('probe'));
    expect(probed.workZBeforeReset).toMatchObject({
      zeroCommand: 'work-offset',
      g92Cleared: false,
    });
  });

  it('carries the record through a second reset and drops it after any other change', () => {
    const first = {
      ...zeroedWith('probe'),
      ...originUnknownAfterControllerReset(zeroedWith('probe')),
    };
    const second = { ...first, ...originUnknownAfterControllerReset(first) };
    expect(currentWorkZBeforeReset(second)?.evidence.toolId).toBe('em-6350');
    expect(second.workZBeforeReset?.referenceEpoch).toBe(6);
    // A bit-change hold, homing or a reconnect moves the epoch on.
    expect(
      currentWorkZBeforeReset({ ...second, workZReferenceEpoch: second.workZReferenceEpoch + 1 }),
    ).toBeNull();
    expect(workZBeforeResetPatch({ ...second, workZReferenceEpoch: 9 }, 10)).toEqual({
      workZBeforeReset: null,
    });
  });

  it('ignores a stale live record', () => {
    const stale = zeroedWith('probe', { workZReferenceEpoch: 7 });
    expect(workZBeforeResetPatch(stale, 8)).toEqual({ workZBeforeReset: null });
  });
});
