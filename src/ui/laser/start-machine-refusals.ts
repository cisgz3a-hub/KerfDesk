// Machine-state Start refusal strings shared between the readiness gate
// (start-job-readiness) and the blocked-Start fix offers, so the offers can
// recognize these refusals exactly without duplicating the wording.

export const ALARM_ACTIVE_START_MESSAGE =
  'Controller is in alarm state. Clear the alarm before starting.';

export function machineNotIdleStartMessage(state: string): string {
  return `Machine must be Idle before starting (currently ${state}).`;
}
