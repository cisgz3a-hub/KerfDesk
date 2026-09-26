// laser-safety-notice — the operator-facing safety alert the laser store raises
// when it CANNOT be sure the machine is in a safe state. Three cases (P0-B, P0-1):
//
//   - write-failed: an Abort / Pause / Resume / Disconnect command's serial write
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
  | 'probe'
  | 'autofocus'
  | 'air-assist'
  | 'fire'
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
      readonly kind: 'disconnect-during-fire';
      readonly message: string;
    }
  | {
      readonly kind: 'disconnect-stop-unconfirmed';
      readonly message: string;
    }
  | {
      readonly kind: 'controller-error';
      readonly code: number | null;
      readonly raw?: string;
      readonly rejectedLine?: string;
      readonly message: string;
      /** The firmware halted itself and needs a reset or power cycle. */
      readonly halted?: true;
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
    }
  | {
      readonly kind: 'home-unfinished';
      readonly message: string;
    }
  | {
      /** CNC Pause and lift could not lift or re-enter safely (ADR-401). */
      readonly kind: 'cnc-pause-lift-failed';
      readonly message: string;
    };

// M13 (AUDIT-2026-06-10): the streamer is ack-driven — if GRBL stops
// answering (wedged firmware, half-dead USB, EMI) the job sat at a frozen
// percentage forever with no signal. The watchdog raises this notice when
// nothing acks and fresh Run status stops arriving for STREAM_STALL_TIMEOUT_MS
// while lines are in flight.
export const STREAM_STALLED_MESSAGE =
  'The controller has not acknowledged a command or reported fresh movement status for longer ' +
  'than the active-link watchdog window. KerfDesk froze the stream and requested a controller ' +
  'soft reset while the link was still present. Use the physical E-stop or power cutoff if the ' +
  'machine did not stop, then check the USB link before re-running.';

export function streamStalledNotice(): LaserSafetyNotice {
  return { kind: 'stream-stalled', message: STREAM_STALLED_MESSAGE };
}

export const CNC_PAUSE_RESUME_STALLED_MESSAGE =
  'The controller did not confirm CNC Pause or Resume within the live-transition deadline. ' +
  'KerfDesk froze the host stream and kept the job; no controller reset was requested. Check the ' +
  'machine state, then retry Resume or request ABORT JOB. Use the physical E-stop or power cutoff ' +
  'if the spindle or cutter is unsafe.';

// ADR-401: once Pause and lift has soft-reset the controller, the buffered
// job is gone, so a lift or re-entry that cannot finish ends the job with a
// reset rather than leaving the spindle or the bit where nobody expects them.
export function cncPauseLiftFailedNotice(reason: string): LaserSafetyNotice {
  return {
    kind: 'cnc-pause-lift-failed',
    message:
      `Pause and lift stopped: ${reason} KerfDesk reset the controller to stop the spindle ` +
      'and motion, and ended the job. Check the machine, then continue from the Interrupted ' +
      'job card. Use the physical E-stop if the cutter is unsafe.',
  };
}

export function cncPauseResumeStalledNotice(): LaserSafetyNotice {
  return { kind: 'stream-stalled', message: CNC_PAUSE_RESUME_STALLED_MESSAGE };
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

export const DISCONNECT_DURING_FIRE_MESSAGE =
  'USB connection was lost while the momentary Fire beam was requested. Software can no longer ' +
  'confirm M5 reached the controller. Use physical E-stop or power cutoff now.';

export function disconnectDuringFireNotice(): LaserSafetyNotice {
  return { kind: 'disconnect-during-fire', message: DISCONNECT_DURING_FIRE_MESSAGE };
}

// A controller with neither a realtime reset nor quickstop lines (see
// QUICK_STOP_UNCONFIRMED_MESSAGE for Marlin).
export const DISCONNECT_STOP_UNCONFIRMED_MESSAGE =
  'This controller has no realtime reset, so KerfDesk could only stop sending and queue ' +
  'beam-off commands. Buffered motion or laser output may still be active. ' +
  'Use the physical E-stop or power cutoff now if unsafe, and confirm the machine is physically ' +
  'stopped before reconnecting.';

export function disconnectStopUnconfirmedNotice(): LaserSafetyNotice {
  return { kind: 'disconnect-stop-unconfirmed', message: DISCONNECT_STOP_UNCONFIRMED_MESSAGE };
}

// Marlin stopped with M107, M410 and M5 I (controller audit MA-7): M410 drops
// the planned moves when Marlin reads it, without a reset, and the beam-off
// lines follow. Nothing confirms the stop before this notice is raised.
export const QUICK_STOP_UNCONFIRMED_MESSAGE =
  'Marlin was quick-stopped: KerfDesk sent M107, M410 and M5 I, which drop the moves Marlin had ' +
  'queued and switch the laser off within about a second. A quick stop halts the motors ' +
  'without slowing down, so the position may have slipped: re-home, or re-check the origin, ' +
  'before running again. Use the physical E-stop or power cutoff now if the machine is still ' +
  'moving or the beam is still on.';

export function quickStopUnconfirmedNotice(): LaserSafetyNotice {
  return { kind: 'disconnect-stop-unconfirmed', message: QUICK_STOP_UNCONFIRMED_MESSAGE };
}

// Marlin kill() (M112, a failed homing move, a thermal fault): the firmware
// disables interrupts and waits for its RESET button or a power cycle, so it
// answers nothing, reports no Idle and does not recover on its own
// (MarlinCore.cpp L889-L957; controller audit MA-10).
export function controllerHaltedMessage(raw: string): string {
  return (
    `The controller halted its firmware (${raw}) and answers nothing until it is reset. ` +
    "Press the controller's reset button or power-cycle it, then reconnect. Position is unknown " +
    'after a halt, so home before running a job. Use the physical E-stop or power cutoff now if unsafe.'
  );
}

export function controllerHaltedNotice(raw: string): LaserSafetyNotice {
  return {
    kind: 'controller-error',
    code: null,
    raw,
    message: controllerHaltedMessage(raw),
    halted: true,
  };
}

/** A halted controller runs nothing it is sent, so a later stop notice must
 * not replace the reset advice. */
export function isControllerHaltedNotice(notice: LaserSafetyNotice | null): boolean {
  return notice?.kind === 'controller-error' && notice.halted === true;
}

/** The controller skipped a command it has no handler for: its firmware
 * build lacks the option that provides it (controller audit MA-12). */
export type SkippedCommand = {
  readonly command: string;
  readonly raw: string;
  /** The build option that provides the command, when the driver knows it. */
  readonly requirement: string | null;
};

export function skippedCommandReason(skipped: SkippedCommand): string {
  const feature = skipped.requirement ?? 'the firmware option that provides it';
  return `The controller answered "Unknown command" to ${skipped.command}: this firmware build lacks ${feature}.`;
}

export function skippedCommandNotice(
  skipped: SkippedCommand,
  rejectedLine: string,
): LaserSafetyNotice {
  return {
    kind: 'controller-error',
    code: null,
    raw: skipped.raw,
    rejectedLine: rejectedLine.trim(),
    message:
      `The controller skipped ${skipped.command} during the job. ${skippedCommandReason(skipped)} ` +
      'KerfDesk stopped the job, because the rest of it would run without that command. Use the ' +
      'physical E-stop or power cutoff now if unsafe. Enable that option in the firmware, or ' +
      'change the device profile so the job does not send the command, then home before re-running.',
  };
}

// ADR-053 P3: a hard-limit ALARM fired while a Verified Frame was tracing the
// job box, i.e. the job does not fit the travel from this hand-set origin. The
// alarm cleared the origin (G92) and the verification, so the operator must
// reset, unlock, re-home the origin somewhere safer (or shrink the job), and
// re-frame. A hard limit is a critical event: the controller takes only a soft
// reset until it gets one (ADR-393).
export function frameHitLimitMessage(axisLabel: string | null): string {
  const where = axisLabel === null ? 'a limit switch' : `the ${axisLabel} limit switch`;
  return (
    `The Verified Frame hit ${where} — the job does not fit the travel from this origin. ` +
    'Press Reset (Ctrl-X), then Unlock ($X), move the origin away from that edge or shrink the ' +
    'job, set the origin again, then re-frame before starting.'
  );
}

export function frameHitLimitNotice(axisLabel: string | null): LaserSafetyNotice {
  return { kind: 'frame-limit', message: frameHitLimitMessage(axisLabel) };
}

/** The controller answered its Home, but reports the axes not homed (SM-6). */
export function homeNotConfirmedNotice(reason: string): LaserSafetyNotice {
  return { kind: 'home-unfinished', message: `Home was not confirmed. ${reason}` };
}

/** Home ended without the controller confirming it: a timeout, an alarm, or a
 *  change that voided the attempt. Not a rejection, so it is not worded as one
 *  (controller audit 2026-09-25 ST-4). */
export function homeUnfinishedNotice(reason: string): LaserSafetyNotice {
  return {
    kind: 'home-unfinished',
    message:
      `Home did not finish: ${reason} The machine may have stopped anywhere or may still be ` +
      'homing. Wait until it stops, check it, then Home again.',
  };
}

export function writeFailedMessage(action: LaserSafetyAction): string {
  if (action === 'stop') {
    return (
      'The software Abort command was not written to the controller. Use physical E-stop or power ' +
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
      'buffered commands — press ABORT; use physical E-stop or power cutoff now if unsafe.'
    );
  }
  if (action === 'fire') {
    return (
      'The Fire command was not written to the controller. Release the Fire control and use ' +
      'physical E-stop or power cutoff now if the beam may still be on.'
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
