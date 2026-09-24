// Machine-state Start refusal strings shared between the readiness gate
// (start-job-readiness) and the blocked-Start fix offers, so the offers can
// recognize these refusals exactly without duplicating the wording. Frame
// reports the same refusals, so each one names its remedy and ends with "try
// again" instead of assuming the operator pressed Start.

export const ALARM_ACTIVE_START_MESSAGE =
  'Controller is in Alarm. Home it if the machine has homing switches, or Unlock it once the ' +
  'head is safe, then try again.';

export function machineNotIdleStartMessage(state: string): string {
  const refusal = `Machine must be Idle first (currently ${state}).`;
  const remedy = notIdleRemedy(state);
  return remedy === null ? refusal : `${refusal} ${remedy}`;
}

// What returns each non-Idle state to Idle. Alarm has none here: the alarm
// message reported beside this one already names Home and Unlock.
function notIdleRemedy(state: string): string | null {
  switch (state) {
    case 'Alarm':
      return null;
    case 'Hold':
      return 'Release the feed hold with cycle start on the machine, then try again.';
    case 'Door':
      return 'Close the door or lid and release the hold with cycle start on the machine, then try again.';
    case 'Sleep':
      return 'Wake the controller, then try again.';
    case 'Check':
      return 'Leave check mode by sending $C again, then try again.';
    default:
      return 'Wait for it to finish and report Idle, then try again.';
  }
}
