// What the first reconnect after a lost link says about the stopped job
// (ADR-398 Amendment 3).
//
// GRBL answers a line once it is queued, not once it has moved, so a stop that
// discards the planner also discards acknowledged moves, and the automatic
// restart steps back over them (ADR-398 Decision 2). A lost link was saved as
// if the controller always kept running what it had. An Arduino-class board
// does not: the serial port's DTR line is wired to its reset, the browser
// asserts DTR when it opens the port, and auto-connect reopens within about a
// second, so the board resets and throws its planner away (GRBL main.c
// `plan_reset()`). One powered from USB stops the moment the cable is pulled.
//
// The record keeps the backlog aside, and the first reconnect decides:
// - a boot banner before the controller's first status report means it
//   restarted;
// - an Alarm means its motion was stopped, which also clears the planner;
// - a status report without either means it kept running, and Continue from
//   where the head stopped still holds (ADR-341 Amendment 6).

import type { JobInterruption } from './job-interruption';

export type LinkLossRestartEvidence = 'boot-banner' | 'alarm' | 'kept-running';

const RESTARTED_MESSAGES: Record<Exclude<LinkLossRestartEvidence, 'kept-running'>, string> = {
  'boot-banner':
    'The USB connection was lost during the job, and the controller sent its startup banner when ' +
    'it reconnected. It had restarted, as an Arduino-based board does when its port reopens or ' +
    'its USB power drops, and a restart throws away the moves it had buffered. The automatic ' +
    'restart steps back over them.',
  alarm:
    'The USB connection was lost during the job, and the controller was in Alarm when it ' +
    'reconnected. Its motion had been stopped, which throws away the moves it had buffered. The ' +
    'automatic restart steps back over them.',
};

/** Whether this interruption still waits for the first reconnect's verdict. */
export function awaitsLinkLossVerdict(interruption: JobInterruption): boolean {
  return interruption.kind === 'disconnect' && interruption.plannerBacklogIfRestarted !== undefined;
}

/** The interruption once the first reconnect has shown whether the
 * controller restarted; null when it does not wait for that verdict. */
export function settleLinkLossRestart(
  interruption: JobInterruption,
  evidence: LinkLossRestartEvidence,
): JobInterruption | null {
  if (!awaitsLinkLossVerdict(interruption)) return null;
  const { plannerBacklogIfRestarted: backlog, ...settled } = interruption;
  if (evidence === 'kept-running' || backlog === undefined) return settled;
  return { ...settled, plannerBacklog: backlog, message: RESTARTED_MESSAGES[evidence] };
}
