// work-z-before-reset — the Work Z record a controller reset voided, kept so
// CNC pass recovery can still tell which bit was zeroed and whether that zero
// survived (CNC audit v3 N5-P1-1, ADR-215 Amendment 3, ADR-215 Amendment 2's
// H3-P1-1 check).
//
// Every reset or alarm voids `workZZeroEvidence`, because it may have cost
// position (originUnknownAfterControllerReset). An Abort is such a reset, and
// recovery then found no record at all: the start-bit check passed by default,
// and a zero made at a bit-change hold with Zero Z (`G92 Z0`), which stock GRBL
// and FluidNC clear at that reset, left the work offset back at the value
// archived at Start, so "Position retained" passed too. The previous bit's
// passes then streamed with the new bit at the old bit's zero.
//
// The record names the bit, how it was zeroed (Zero Z writes G92; the probe
// and the controller read-back are G10/G54 offsets, which every GRBL-family
// controller keeps) and whether the reset cleared that G92 (grblHAL keeps it,
// gcode.c:787). It is valid only while nothing else has touched Work Z since:
// it carries the reference epoch the reset left, and any later invalidation
// (a bit-change hold, homing, a reconnect, a console offset change) moves the
// epoch on. Consecutive resets carry it forward.

import type { ControllerKind } from '../../core/devices';
import { isWorkZZeroEvidenceCurrent, type WorkZZeroEvidence } from './work-z-zero-evidence';

export type WorkZBeforeReset = {
  readonly evidence: WorkZZeroEvidence;
  /** Zero Z writes `G92 Z0`; the probe and the read-back are work offsets. */
  readonly zeroCommand: 'g92' | 'work-offset';
  /** A reset cleared that G92: the controller's Z zero is the one under it. */
  readonly g92Cleared: boolean;
  /** `workZReferenceEpoch` as the reset left it. */
  readonly referenceEpoch: number;
};

export type WorkZBeforeResetState = {
  /** Optional so hand-built test states stay valid; absent reads as none. */
  readonly workZBeforeReset?: WorkZBeforeReset | null;
};

type ResetSource = WorkZBeforeResetState & {
  readonly workZZeroEvidence: WorkZZeroEvidence | null;
  readonly workZReferenceEpoch: number;
  readonly activeControllerKind?: ControllerKind;
  readonly detectedControllerKind?: ControllerKind | null;
};

/** The record a reset leaves; `nextEpoch` is the epoch the same reset sets. */
export function workZBeforeResetPatch(
  state: ResetSource,
  nextEpoch: number,
): Required<WorkZBeforeResetState> {
  const voided = voidedRecord(state);
  if (voided === null) return { workZBeforeReset: null };
  // Unknown firmware counts as clearing: a kept zero is the riskier claim.
  const keepsG92 =
    state.activeControllerKind === 'grblhal' || state.detectedControllerKind === 'grblhal';
  return {
    workZBeforeReset: {
      ...voided,
      g92Cleared: voided.g92Cleared || (voided.zeroCommand === 'g92' && !keepsG92),
      referenceEpoch: nextEpoch,
    },
  };
}

/** The live record this reset voids, or the one an earlier reset left. */
function voidedRecord(state: ResetSource): Omit<WorkZBeforeReset, 'referenceEpoch'> | null {
  const evidence = state.workZZeroEvidence;
  if (isWorkZZeroEvidenceCurrent(evidence, state.workZReferenceEpoch) && evidence !== null) {
    return { evidence, zeroCommand: zeroCommandOf(evidence.source), g92Cleared: false };
  }
  return currentWorkZBeforeReset(state);
}

/** The record while nothing has touched Work Z since the reset, else null. */
export function currentWorkZBeforeReset(
  state: WorkZBeforeResetState & { readonly workZReferenceEpoch: number },
): WorkZBeforeReset | null {
  const record = state.workZBeforeReset ?? null;
  return record !== null && record.referenceEpoch === state.workZReferenceEpoch ? record : null;
}

function zeroCommandOf(source: WorkZZeroEvidence['source']): WorkZBeforeReset['zeroCommand'] {
  return source === 'manual-zero' ? 'g92' : 'work-offset';
}
