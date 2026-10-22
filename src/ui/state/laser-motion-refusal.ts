// laser-motion-refusal — a move the controller skipped without moving and then
// answered `ok` (controller audit v2 C6-P2-2, ADR-395 Amendment 1). Marlin built
// with NO_MOTION_BEFORE_HOMING echoes `Home XYZ First` for every G0-G3 while an
// axis is unhomed, and a stopped Marlin prints "Printer stopped due to errors"
// for each one. Taken for success, a Frame whose moves were all skipped ended
// where it began and counted as completed, and a job on a fan-wired laser ran
// its M106 power at the parked head. The driver classifies both as a rejection
// of the line (laser-error-line.ts), so the Frame, jog, job or owned command
// stops; this module words the notice.

import type { MotionRefusal } from '../../core/controllers/controller-event';
import {
  axisList,
  motionRefusalReason,
  type ControllerErrorContext,
  type LaserSafetyNotice,
} from './laser-safety-notice';

const OUTCOME: Readonly<Record<ControllerErrorContext, string>> = {
  job:
    'KerfDesk stopped the job: its later moves would be skipped too while its laser commands ' +
    'still ran at the parked head. Use the physical E-stop or power cutoff now if unsafe.',
  frame: 'KerfDesk stopped the Frame, so it does not count as completed.',
  jog: 'KerfDesk stopped the jog.',
  // Also a stopped Marlin's own Error: announcement, which answers no command.
  command: '',
};

const RETRY: Readonly<Record<ControllerErrorContext, string>> = {
  job: 'Frame and start again',
  frame: 'Frame again',
  jog: 'jog again',
  command: 'try again',
};

export function motionRefusedNotice(
  refusal: MotionRefusal,
  context: ControllerErrorContext,
  raw: string | undefined,
  rejectedLine: string | undefined,
): LaserSafetyNotice {
  return {
    kind: 'controller-error',
    code: null,
    ...(raw === undefined ? {} : { raw }),
    ...(rejectedLine === undefined ? {} : { rejectedLine: rejectedLine.trim() }),
    message: [motionRefusalReason(refusal), OUTCOME[context], advice(refusal, RETRY[context])]
      .filter((sentence) => sentence !== '')
      .join(' '),
  };
}

function advice(refusal: MotionRefusal, retry: string): string {
  if (refusal.reason === 'stopped') {
    // Plain M999 also flushes the queue and asks for a line resend (M999.cpp),
    // which KerfDesk does not support; M999 S1 only clears the stopped state.
    return (
      'Read the error in the Laser Log, send M999 S1 from the Console to restart the ' +
      `controller, then home and ${retry}.`
    );
  }
  const beyondXy = refusal.axes.replace(/[XY]/g, '');
  if (beyondXy === '') return `Home the machine, then ${retry}.`;
  // KerfDesk's Home is G28 X Y (marlin/commands.ts): under a plain G28 a laser
  // conversion without a Z endstop would drive Z into its stop.
  const homeXy = beyondXy.length < refusal.axes.length ? 'Home the machine. ' : '';
  return (
    `${homeXy}KerfDesk's Home homes X and Y only (G28 X Y): home ${axisList(beyondXy)} from ` +
    `the Console (G28 ${[...beyondXy].join(' ')}) if the machine has an endstop for it, or turn ` +
    `NO_MOTION_BEFORE_HOMING off in the firmware. Then ${retry}.`
  );
}
