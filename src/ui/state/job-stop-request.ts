// Why KerfDesk itself stopped a run (ADR-341 Amendment 3). Abort and the page
// closing both mark the stream errored before the reset byte goes out, with no
// safety notice, so the checkpoint tracker used to record every one of them as
// "The job stream ended unexpectedly." The request is keyed by the stream
// epoch, so it never describes a later run.

import type { GrblState, StatusReport, StreamerStatus } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';
import { cncPauseLiftMayBeMoving, type CncPauseLift } from './cnc-pause-lift-state';

export type JobStopReason = 'operator' | 'app-closing';

export type JobStopRequest = {
  readonly reason: JobStopReason;
  readonly streamerEpoch: number;
  /** The Set origin here (G92) XY work offset in effect when an operator Abort
   * reset the controller, in mm from machine zero. Stock GRBL and FluidNC
   * clear it at that reset, so the Alarm 3 card offers it back (ADR-341
   * Amendment 11). Absent when no G92 origin was set. */
  readonly originAtStopMm?: { readonly x: number; readonly y: number };
  /** The store's machineZeroEpoch when originAtStopMm was read: a later one
   *  means machine zero may have moved since (ADR-341 Amendment 13). */
  readonly originMachineZeroEpoch?: number;
  /** A rotary on a dedicated A or Z axis: the machine turn the job started
   *  from. Every such job opens with `G92 A0`, so it is that axis's work
   *  offset (WCO) while the job runs. A re-run turns the part back to it
   *  before zeroing again (ADR-695 Amendment 1). */
  readonly rotaryStartTurn?: RotaryStartTurn;
  /** Laser or CNC, as the stopped job started (`activeJobMachineKind`), read
   *  before the stop clears it. Only a laser job's origin goes back by itself
   *  after the operator's Abort (ADR-341 Amendment 14). */
  readonly jobMachineKind?: MachineKind;
};

/** Where a dedicated-axis rotary job started, in machine units of its axis. */
export type RotaryStartTurn = { readonly axis: 'A' | 'Z'; readonly machine: number };

/** A soft reset KerfDesk sent against the stream of `streamerEpoch` (Abort,
 * the fail-dark stop, the automatic stop after a rejected line), and whether
 * it may have reached a moving machine and killed the steppers (ADR-215
 * Amendment 1, CNC audit MC-3). */
export type StreamReset = {
  readonly streamerEpoch: number;
  readonly positionMayBeLost: boolean;
};

/** The stop request for the current stream, if KerfDesk was asked to stop it. */
export function currentJobStopRequest(state: {
  readonly jobStopRequest?: JobStopRequest | null;
  readonly streamerEpoch: number;
}): JobStopRequest | null {
  const request = state.jobStopRequest ?? null;
  return request !== null && request.streamerEpoch === state.streamerEpoch ? request : null;
}

/** True when KerfDesk sent a reset against the current stream: Abort, the
 * automatic stop after a rejected line, or the reset that contains a lost
 * heartbeat or a failed job write. Any of them discards the controller's
 * planner, so recovery steps back over it (ADR-398 Amendment 5). */
export function currentStreamWasReset(state: {
  readonly streamReset?: StreamReset | null;
  readonly streamerEpoch: number;
}): boolean {
  const reset = state.streamReset ?? null;
  return reset !== null && reset.streamerEpoch === state.streamerEpoch;
}

/** True when a reset KerfDesk sent against the current stream may have cost
 * position. A reset recorded for an earlier stream never describes this one. */
export function currentStreamResetMayLosePosition(state: {
  readonly streamReset?: StreamReset | null;
  readonly streamerEpoch: number;
}): boolean {
  const reset = state.streamReset ?? null;
  return reset !== null && reset.streamerEpoch === state.streamerEpoch && reset.positionMayBeLost;
}

/** The record for a reset about to be sent against the current stream. A
 * later reset of the same stream (Abort after the automatic stop) never clears
 * an earlier reset's loss: by then the controller reports the Alarm it raised. */
export function streamResetRecord(
  state: {
    readonly statusReport: Pick<StatusReport, 'state' | 'subState'> | null;
    readonly streamer: { readonly status: StreamerStatus } | null;
    readonly streamerEpoch: number;
    readonly pauseResumeTransition: unknown;
    readonly streamReset?: StreamReset | null;
    readonly cncPauseLift?: CncPauseLift | null;
  },
  pauseResumeSettling = false,
): StreamReset {
  return {
    streamerEpoch: state.streamerEpoch,
    positionMayBeLost:
      currentStreamResetMayLosePosition(state) ||
      softResetMayLosePosition(
        state.statusReport,
        state.streamer?.status ?? null,
        // A Pause and lift move (ADR-411) runs outside the paused stream.
        pauseResumeSettling ||
          state.pauseResumeTransition !== null ||
          cncPauseLiftMayBeMoving(state),
      ),
  };
}

// The desktop close awaits its Abort; a web page or a forced Windows restart
// may end first (ADR-548 Amendment 1). Either way recovery steps back over the
// planner, so the note claims no more than that the Abort was sent.
export function jobStopRequestMessage(reason: JobStopReason): string {
  return reason === 'app-closing'
    ? 'KerfDesk was closed or reloaded while the job was running, and sent the controller an Abort as it closed.'
    : 'Stopped by the operator (Abort).';
}

// States in which the controller is not moving; Run, Jog and Home are.
const STOPPED_STATES: ReadonlySet<GrblState> = new Set(['Alarm', 'Sleep', 'Check', 'Tool']);

/**
 * Whether a soft reset sent now can kill the steppers mid-motion. GRBL's
 * mc_reset raises ALARM:3 ("Position has likely been lost") in a cycle, a jog,
 * homing, or while a hold is still decelerating or a door is parking or
 * restoring (Hold:1, Door:2, Door:3). A completed hold (Hold:0), a door hold
 * that has stopped (Door:0, Door:1), Idle away from an active stream, and an
 * alarm that already stopped motion keep position. The last status report can
 * be one poll behind, so a pause or resume still settling, an unknown state,
 * and Idle while lines are still being streamed all count as moving.
 */
export function softResetMayLosePosition(
  report: Pick<StatusReport, 'state' | 'subState'> | null,
  streamerStatus: StreamerStatus | null,
  pauseResumeSettling: boolean,
): boolean {
  if (pauseResumeSettling || report === null) return true;
  // `done` means every line was acknowledged, not that the planner drained.
  if (report.state === 'Idle') return streamerStatus === 'streaming' || streamerStatus === 'done';
  if (report.state === 'Hold') return report.subState !== 0;
  if (report.state === 'Door') return report.subState !== 0 && report.subState !== 1;
  return !STOPPED_STATES.has(report.state);
}
