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
  | 'start'
  | 'stop'
  | 'disconnect'
  | 'frame'
  | 'origin'
  | 'jog'
  | 'home'
  | 'air-assist'
  | 'unlock'
  | 'wake'
  | 'console'
  // A mid-job refill send (the ack-driven stream continuing), as opposed to
  // the operator-initiated 'start'/'resume' writes.
  | 'stream';

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
      readonly code: number | null;
      readonly raw?: string;
      readonly rejectedLine?: string;
      readonly message: string;
    }
  | {
      readonly kind: 'stream-stalled';
      readonly message: string;
    }
  | {
      readonly kind: 'controller-reboot';
      readonly message: string;
    }
  | {
      readonly kind: 'frame-limit';
      readonly message: string;
    };

// M13 (AUDIT-2026-06-10): the streamer is ack-driven — if GRBL stops
// answering (wedged firmware, half-dead USB, EMI) the job sat at a frozen
// percentage forever with no signal. The watchdog raises this notice when
// nothing acks and fresh Run status stops arriving for STREAM_STALL_TIMEOUT_MS
// while lines are in flight.
export const STREAM_STALLED_MESSAGE =
  'The controller has not acknowledged a command or reported fresh movement status for longer ' +
  'than the watchdog window while a job is active. The stream may be stalled. Press Stop ' +
  '(or physical E-stop if unsafe), then check the USB link before re-running.';

export function streamStalledNotice(): LaserSafetyNotice {
  return { kind: 'stream-stalled', message: STREAM_STALLED_MESSAGE };
}

// Audit F2: a welcome banner while the stream was still live means the
// controller rebooted UNCOMMANDED (every commanded reset cancels the streamer
// before its banner can arrive). The reboot discarded all buffered motion, so
// the job is over — but the head is parked mid-cut and the work is ruined
// unless re-run from a known origin.
export const CONTROLLER_REBOOT_DURING_JOB_MESSAGE =
  'The controller rebooted while a job was streaming (its startup banner arrived mid-job). ' +
  'The job was aborted and buffered motion is lost. Check the USB cable and controller power, ' +
  'then re-home before running the job again.';

export function controllerRebootNotice(): LaserSafetyNotice {
  return { kind: 'controller-reboot', message: CONTROLLER_REBOOT_DURING_JOB_MESSAGE };
}

export const DISCONNECT_DURING_JOB_MESSAGE =
  'USB connection was lost during an active job. The machine may still be moving from ' +
  'buffered commands. Use physical E-stop or power cutoff now if unsafe. Reconnect and ' +
  'home before continuing.';

export function disconnectDuringJobNotice(): LaserSafetyNotice {
  return { kind: 'disconnect-during-job', message: DISCONNECT_DURING_JOB_MESSAGE };
}

// ADR-053 P3: a hard-limit ALARM fired while a Verified Frame was tracing the
// job box, i.e. the job does not fit the travel from this hand-set origin. The
// alarm cleared the origin (G92) and the verification, so the operator must
// unlock, re-home the origin somewhere safer (or shrink the job), and re-frame.
export function frameHitLimitMessage(axisLabel: string | null): string {
  const where = axisLabel === null ? 'a limit switch' : `the ${axisLabel} limit switch`;
  return (
    `The Verified Frame hit ${where} — the job does not fit the travel from this origin. ` +
    'Unlock ($X), move the origin away from that edge or shrink the job, set the origin again, ' +
    'then re-frame before starting.'
  );
}

export function frameHitLimitNotice(axisLabel: string | null): LaserSafetyNotice {
  return { kind: 'frame-limit', message: frameHitLimitMessage(axisLabel) };
}

export function writeFailedMessage(action: LaserSafetyAction): string {
  if (action === 'stop') {
    return (
      'Stop command was not written to the controller. Use physical E-stop or power ' +
      'cutoff now if unsafe. The machine may still be running.'
    );
  }
  if (action === 'console') {
    return (
      'The console command was not written to the controller; the machine may not have ' +
      'responded. Use physical E-stop or power cutoff now if unsafe.'
    );
  }
  if (action === 'wake') {
    return (
      'The wake soft-reset was not written to the controller; the machine may stay asleep ' +
      'or locked. Use physical E-stop or power cutoff now if unsafe.'
    );
  }
  if (action === 'stream') {
    return (
      'A mid-job send failed, so the stream was stopped. The machine may still be executing ' +
      'buffered commands — press Stop; use physical E-stop or power cutoff now if unsafe.'
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
export type ControllerErrorContext = 'job' | 'frame' | 'jog' | 'command';

export function controllerErrorMessage(
  code: number | null,
  context: ControllerErrorContext = 'job',
  raw?: string,
  rejectedLine?: string,
): string {
  const errorText =
    code === null ? `unrecognized controller error response: ${raw ?? 'error'}` : `error:${code}`;
  const rejectedText = rejectedLine === undefined ? '' : ` Rejected line: ${rejectedLine.trim()}`;
  if (context === 'job') {
    return (
      `The controller rejected a command (${errorText}) during the job, so the job was ` +
      'stopped. The head may be mispositioned and the laser may have fired out of place. ' +
      `Use physical E-stop or power cutoff now if unsafe, then home before re-running.${rejectedText}`
    );
  }
  if (context === 'frame' || context === 'jog') {
    return (
      `The controller rejected a ${context} command (${errorText}). ` +
      'Wait until the controller reports Idle before jogging or framing again. ' +
      `If the head moved unexpectedly, use physical E-stop or power cutoff now if unsafe.${rejectedText}`
    );
  }
  return (
    `The controller rejected a command (${errorText}). ` +
    `Check the Laser Log, wait for Idle, and home before continuing if position is uncertain.${rejectedText}`
  );
}

export function controllerErrorNotice(
  code: number | null,
  context: ControllerErrorContext = 'job',
  raw?: string,
  rejectedLine?: string,
): LaserSafetyNotice {
  return {
    kind: 'controller-error',
    code,
    ...(raw === undefined ? {} : { raw }),
    ...(rejectedLine === undefined ? {} : { rejectedLine: rejectedLine.trim() }),
    message: controllerErrorMessage(code, context, raw, rejectedLine),
  };
}
