// Which operator Abort gets its origin back without a click (user annoyance
// audit A1, finding A3-D-1; ADR-341 Amendment 14).
//
// ABORT JOB resets a GRBL-family controller at once, so the beam is off at
// once (ADR-398 Amendment 8, ADR-215 Amendment 1). Stock GRBL and FluidNC then
// report ALARM:3 and forget a Set origin here origin, and the "You stopped the
// job" card offers it back (Amendment 11). On a laser without homing that
// card's main action moves nothing: Unlock, then one G92. This module decides
// when that same action may run by itself, and when the card must stay a
// choice. It commands nothing; abort-auto-restore.ts runs the verdict.
//
// Everything that is not exactly that case keeps the card: a CNC job (work Z
// must be zeroed again), a profile with homing (Home moves the head), a
// rotary (the part may have turned or slipped), a machine zero that may have
// moved (Amendment 13), a controller that needs a reset, a controller that
// keeps the origin (grblHAL), any notice of a fault, and an operator who has
// already unlocked or set an origin.

import type { ControllerKind } from '../../core/devices';
import type { MachineKind } from '../../core/scene';
import { currentStreamResetMayLosePosition, type JobStopRequest } from '../state/job-stop-request';
import type { LaserState } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { operatorAbortAlarm } from './abort-alarm-recovery';
import { alarmControllerKind } from './alarm-card-advice';

/** What the open project says about the machine. */
export type AbortAutoRestoreProfile = {
  readonly homingEnabled: boolean;
  readonly machineKind: MachineKind;
  /** A rotary is switched on, on Y or on its own axis. */
  readonly rotaryActive: boolean;
};

export type AbortAutoRestoreExclusion =
  | 'not-the-operator-abort-alarm'
  | 'reset-not-into-motion'
  | 'not-a-laser-job'
  | 'no-saved-origin'
  | 'rotary'
  | 'homing-on'
  | 'machine-zero-moved'
  | 'reset-required'
  | 'no-unlock'
  | 'controller-keeps-origin'
  | 'fault-notice'
  | 'door-or-estop'
  | 'operator-acted';

export type AbortAutoRestoreVerdict =
  /** The card's motion-free Restore saved origin may run by itself. */
  | {
      readonly kind: 'restore';
      readonly request: JobStopRequest;
      readonly savedMm: { readonly x: number; readonly y: number };
    }
  /** It may, once the controller has settled in its Alarm. */
  | { readonly kind: 'wait'; readonly request: JobStopRequest }
  /** The card and its buttons stay as they are. */
  | { readonly kind: 'card'; readonly reason: AbortAutoRestoreExclusion };

// Stock GRBL and FluidNC clear a G92 origin at a soft reset. grblHAL keeps it
// (ADR-375), so there the card's wording and its confirm stay the operator's.
const CLEARS_ORIGIN_AT_RESET: ReadonlyArray<ControllerKind> = ['grbl-v1.1', 'fluidnc'];

type Facts = {
  readonly laser: LaserState;
  readonly profile: AbortAutoRestoreProfile;
  readonly request: JobStopRequest;
};

// In order; the first that holds is the reason the card stays.
const EXCLUSIONS: ReadonlyArray<readonly [AbortAutoRestoreExclusion, (facts: Facts) => boolean]> = [
  // An ALARM:3 the Abort's own record did not expect is not this alarm.
  ['reset-not-into-motion', ({ laser }) => !currentStreamResetMayLosePosition(laser)],
  [
    'not-a-laser-job',
    ({ request, profile }) => request.jobMachineKind !== 'laser' || profile.machineKind !== 'laser',
  ],
  ['no-saved-origin', ({ request }) => request.originAtStopMm === undefined],
  // On its own axis the restore turns the part back, which is motion.
  [
    'rotary',
    ({ request, profile }) => profile.rotaryActive || request.rotaryStartTurn !== undefined,
  ],
  ['homing-on', ({ profile }) => profile.homingEnabled],
  [
    'machine-zero-moved',
    ({ laser, request }) => request.originMachineZeroEpoch !== (laser.machineZeroEpoch ?? 0),
  ],
  ['reset-required', ({ laser }) => (laser.resetRequired ?? false) !== false],
  ['no-unlock', ({ laser }) => !laser.capabilities.unlock],
  [
    'controller-keeps-origin',
    ({ laser }) => !CLEARS_ORIGIN_AT_RESET.includes(alarmControllerKind(laser)),
  ],
  ['fault-notice', ({ laser }) => laser.safetyNotice !== null],
  [
    'door-or-estop',
    ({ laser }) =>
      laser.statusReport?.pins?.door === true || laser.statusReport?.pins?.estop === true,
  ],
  // An origin is set again, or the controller was unlocked: someone was here.
  [
    'operator-acted',
    ({ laser }) => laser.workOriginActive || laser.positionEvidenceSuppressed === true,
  ],
];

/** Whether the controller sits in its Alarm with nothing in flight: connected,
 *  reporting Alarm, no job, no controller or motion operation, no reply owed. */
export function abortAlarmSettled(laser: LaserState): boolean {
  return (
    laser.connection.kind === 'connected' &&
    laser.statusReport?.state === 'Alarm' &&
    laser.controllerOperation === null &&
    laser.motionOperation === null &&
    !isActiveJob(laser.streamer) &&
    laser.pendingUntrackedAcks === 0 &&
    !laser.autofocusBusy
  );
}

/** The verdict for the current store state and open project. */
export function abortAutoRestoreVerdict(
  laser: LaserState,
  profile: AbortAutoRestoreProfile,
): AbortAutoRestoreVerdict {
  const request = operatorAbortAlarm(laser);
  if (request === null) return { kind: 'card', reason: 'not-the-operator-abort-alarm' };
  const excluded = EXCLUSIONS.find(([, holds]) => holds({ laser, profile, request }));
  if (excluded !== undefined) return { kind: 'card', reason: excluded[0] };
  const savedMm = request.originAtStopMm;
  if (savedMm === undefined) return { kind: 'card', reason: 'no-saved-origin' };
  return abortAlarmSettled(laser)
    ? { kind: 'restore', request, savedMm }
    : { kind: 'wait', request };
}
