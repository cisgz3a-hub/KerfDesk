// What the first reconnect after a lost link says about the stopped job
// (ADR-398 Amendments 3 and 4).
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
// - Run or Hold proves it kept running; an idle board may have restarted
//   before reconnect and printed a banner while the link was unavailable.
//
// A banner is not always a boot (Amendment 4). grblHAL greets every new
// Telnet, WebSocket or Bluetooth client, and a native-USB build greets 200 ms
// after the port opens, with the same banner and no reset (core `stream.c`
// `stream_select`, `stream_usb_linestate_changed`). A board on Wi-Fi or
// Ethernet that did restart printed its boot banner before its network came
// up. Where the banner proves nothing, a running or held machine still shows
// it kept running; anything else leaves the restart unknown, the automatic
// restart does not step back, and the hint names the line that would.

import type { JobInterruption } from './job-interruption';

export type LinkLossRestartSign = 'boot-banner' | 'alarm' | 'kept-running' | 'unknown';

/** The link the reconnect came over, which the Review names. */
export type LinkLossLink = 'usb' | 'network';

export type LinkLossRestartEvidence = {
  readonly sign: LinkLossRestartSign;
  readonly link: LinkLossLink;
};

const LINK_NAMES: Record<LinkLossLink, string> = {
  usb: 'USB connection',
  network: 'network connection',
};

const RESTART_CAUSES: Record<LinkLossLink, string> = {
  usb:
    'It had restarted, as a board does when opening its port resets it or its USB power drops, ' +
    'and a restart throws away the moves it had buffered.',
  network: 'It had restarted, and a restart throws away the moves it had buffered.',
};

const UNCONFIRMED_CAUSES: Record<LinkLossLink, string> = {
  usb:
    'A USB startup banner may have been sent before the port reopened; grblHAL can also send ' +
    'a greeting each time its USB port opens without restarting.',
  network:
    'Over Wi-Fi or Ethernet the startup banner settles nothing either way: grblHAL sends one to ' +
    'every new connection, and a board that restarted sent its own before its network came up.',
};

function restartedMessage({ sign, link }: LinkLossRestartEvidence): string {
  const lost = `The ${LINK_NAMES[link]} was lost during the job, and the controller`;
  if (sign === 'alarm') {
    return (
      `${lost} was in Alarm when it reconnected. Its motion had been stopped, which throws ` +
      'away the moves it had buffered. The automatic restart steps back over them.'
    );
  }
  return (
    `${lost} sent its startup banner when it reconnected. ${RESTART_CAUSES[link]} ` +
    'The automatic restart steps back over them.'
  );
}

function unconfirmedMessage(link: LinkLossLink): string {
  return (
    `The ${LINK_NAMES[link]} was lost during the job, and the reconnect does not show whether ` +
    `the controller restarted. ${UNCONFIRMED_CAUSES[link]} If it kept running, it finished the ` +
    'moves it had buffered; if it restarted, it threw them away. The automatic restart assumes ' +
    'it kept running. Inspect the work, and if those moves did not burn, restart from the ' +
    'earlier line the restart hint names.'
  );
}

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
  if (evidence.sign === 'kept-running' || backlog === undefined) return settled;
  if (evidence.sign === 'unknown') {
    return {
      ...settled,
      unconfirmedPlannerBacklog: backlog,
      message: unconfirmedMessage(evidence.link),
    };
  }
  return { ...settled, plannerBacklog: backlog, message: restartedMessage(evidence) };
}
