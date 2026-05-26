/**
 * Shared GRBL ALARM:N policy for UI copy and post-unlock proof handling.
 * GRBL's live `alarm` state always blocks Start; this helper answers the
 * narrower question of whether existing frame/WCS/origin proof may still be
 * trusted after the alarm is cleared.
 */

interface GrblAlarmPolicy {
  readonly description: string;
  readonly invalidatesPositionProof: boolean;
}

const ALARM_POLICIES: Record<number, GrblAlarmPolicy> = {
  1: {
    description: 'hard limit triggered',
    invalidatesPositionProof: true,
  },
  2: {
    description: 'soft limit alarm (motion target exceeds machine travel)',
    invalidatesPositionProof: false,
  },
  3: {
    description: 'reset while in motion',
    invalidatesPositionProof: true,
  },
  4: {
    description: 'probe fail (initial state)',
    invalidatesPositionProof: false,
  },
  5: {
    description: 'probe fail (no contact)',
    invalidatesPositionProof: false,
  },
  6: {
    description: 'homing fail (reset during homing)',
    invalidatesPositionProof: true,
  },
  7: {
    description: 'homing fail (door opened during homing)',
    invalidatesPositionProof: true,
  },
  8: {
    description: 'homing fail (pull-off failed to clear limit switch)',
    invalidatesPositionProof: true,
  },
  9: {
    description: 'homing fail (could not find limit switch)',
    invalidatesPositionProof: true,
  },
  10: {
    description: 'homing fail (dual-axis limit switch not found)',
    invalidatesPositionProof: true,
  },
};

function policyForAlarmCode(code: number | null | undefined): GrblAlarmPolicy | null {
  if (typeof code !== 'number' || !Number.isInteger(code)) return null;
  return ALARM_POLICIES[code] ?? null;
}

export function describeGrblAlarmCode(code: number | null | undefined): string {
  return policyForAlarmCode(code)?.description ?? 'unknown alarm code';
}

export function alarmInvalidatesPositionProof(code: number | null | undefined): boolean {
  return policyForAlarmCode(code)?.invalidatesPositionProof ?? true;
}

export function alarmAllowsRetainingPositionProof(code: number | null | undefined): boolean {
  return !alarmInvalidatesPositionProof(code);
}
