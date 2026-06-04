// laser-safety-notice — the operator-facing safety alert the laser store raises
// when it CANNOT be sure the machine is in a safe state. Three cases (P0-B, P0-1):
//
//   - write-failed: a Stop / Pause / Resume / Disconnect command's serial write
//     threw. The controller may not have received it, so the machine may still
//     be moving. Software cannot fix this — the operator must reach for the
//     physical control.
//   - disconnect-during-job: the USB link dropped while a job was streaming or
//     paused. GRBL keeps executing the commands already in its 127-byte buffer;
//     a browser/serial disconnect event is NOT proof the controller stopped.
//   - controller-error: GRBL rejected a line mid-job (error:N). The stream is
//     stopped (P0-1), but the head may be mispositioned and a laser-on line may
//     have fired out of place, so the operator must check the machine.
//
// The copy is deliberately blunt and names the PHYSICAL control, because once
// the link is gone no software command can stop motion (GRBL laser_mode notes:
// Ctrl-X soft reset cannot be sent after USB is gone).

export type LaserSafetyAction =
  | 'pause'
  | 'resume'
  | 'stop'
  | 'disconnect'
  | 'frame'
  | 'origin'
  | 'jog'
  | 'home';

export type LaserSafetyNotice =
  | {
      readonly kind: 'write-failed';
      readonly action: LaserSafetyAction;
      readonly message: string;
    }
  | {
      readonly kind: 'disconnect-during-job';
      readonly message: string;
    }
  | {
      readonly kind: 'controller-error';
      readonly code: number;
      readonly message: string;
    };

export const DISCONNECT_DURING_JOB_MESSAGE =
  'USB connection was lost during an active job. The machine may still be moving from ' +
  'buffered commands. Use physical E-stop or power cutoff now if unsafe. Reconnect and ' +
  'home before continuing.';

export function writeFailedMessage(action: LaserSafetyAction): string {
  if (action === 'stop') {
    return (
      'Stop command was not written to the controller. Use physical E-stop or power ' +
      'cutoff now if unsafe. The machine may still be running.'
    );
  }
  return (
    `The ${action} command was not written to the controller; the machine may not have ` +
    'responded. Use physical E-stop or power cutoff now if unsafe.'
  );
}

export function writeFailedNotice(action: LaserSafetyAction): LaserSafetyNotice {
  return { kind: 'write-failed', action, message: writeFailedMessage(action) };
}

// P0-1: GRBL rejected a line mid-job (error:N). The streamer goes terminal
// ('errored') so no more bytes are sent, but the rejected move may have left
// the head mispositioned and a subsequent laser-on line may have fired out of
// place. The copy names the PHYSICAL control for the same reason as the others.
export function controllerErrorMessage(code: number): string {
  return (
    `The controller rejected a command (error:${code}) during the job, so the job was ` +
    'stopped. The head may be mispositioned and the laser may have fired out of place. ' +
    'Use physical E-stop or power cutoff now if unsafe, then home before re-running.'
  );
}

export function controllerErrorNotice(code: number): LaserSafetyNotice {
  return { kind: 'controller-error', code, message: controllerErrorMessage(code) };
}
