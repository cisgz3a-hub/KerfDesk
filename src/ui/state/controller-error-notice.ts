// P0-1: GRBL rejected a line mid-job (error:N). The streamer goes terminal
// ('errored') so no more bytes are sent, but the rejected move may have left
// the head mispositioned and a subsequent laser-on line may have fired out of
// place. The copy names the PHYSICAL control for the same reason as the other
// safety notices (laser-safety-notice.ts). The code is decoded with the
// Console's tables, and the advice names the Console, where every reply is
// shown (UX audit U2-P2-2).

import type { ControllerKind } from '../../core/devices';
import {
  controllerRejectionText,
  homingOffAdvice,
  rejectionSentences,
  type ControllerRejectionText,
} from './controller-rejection-text';
import type { LaserSafetyNotice } from './laser-safety-notice';

export type ControllerErrorContext = 'job' | 'frame' | 'jog' | 'command';

export function controllerErrorMessage(
  code: number | null,
  context: ControllerErrorContext = 'job',
  raw?: string,
  rejectedLine?: string,
  controllerKind: ControllerKind = 'grbl-v1.1',
): string {
  const rejection = controllerRejectionText(controllerKind, code, raw);
  const rejectedText = rejectedLine === undefined ? '' : ` Rejected line: ${rejectedLine.trim()}`;
  if (context === 'job') return `${jobMessage(rejection)}${rejectedText}`;
  if (rejection.homingOff) {
    return `Home was refused: ${rejection.reason}. ${homingOffAdvice(controllerKind)}${rejectedText}`;
  }
  return `${commandMessage(rejection, context, rejectedLine)}${rejectedText}`;
}

function jobMessage(rejection: ControllerRejectionText): string {
  return (
    `The controller ${rejection.alarm ? 'raised an alarm' : 'rejected a command'} during the ` +
    `job, so the job was stopped: ${rejectionSentences(rejection)} The head may be ` +
    'mispositioned and the laser may have fired out of place. Use physical E-stop or power ' +
    'cutoff now if unsafe, then home before re-running.'
  );
}

function commandMessage(
  rejection: ControllerRejectionText,
  context: Exclude<ControllerErrorContext, 'job'>,
  rejectedLine: string | undefined,
): string {
  const lead = rejection.alarm
    ? 'The controller raised an alarm'
    : `The controller rejected ${context === 'command' ? 'a' : `a ${context}`} command`;
  const what = rejectionSentences(rejection);
  if (context === 'frame' || context === 'jog') {
    return (
      `${lead}: ${what} Wait until the controller reports Idle before jogging or framing ` +
      'again. If the head moved unexpectedly, use physical E-stop or power cutoff now if unsafe.'
    );
  }
  // A refused `$` command ($X, $H, a $N= setting write) moved nothing, so
  // homing again is no advice for it (UX audit U5: error:79, error:17).
  const homeAdvice = rejectedLine?.trim().startsWith('$')
    ? ''
    : ' If the position is uncertain, home before continuing.';
  return `${lead}: ${what}${homeAdvice} The Console shows every reply from the controller.`;
}

export function controllerErrorNotice(
  code: number | null,
  context: ControllerErrorContext = 'job',
  raw?: string,
  rejectedLine?: string,
  controllerKind?: ControllerKind,
): LaserSafetyNotice {
  const homingOff =
    context !== 'job' &&
    controllerRejectionText(controllerKind ?? 'grbl-v1.1', code, raw).homingOff;
  return {
    kind: 'controller-error',
    code,
    ...(homingOff ? { homingOff: true as const } : {}),
    ...(raw === undefined ? {} : { raw }),
    ...(rejectedLine === undefined ? {} : { rejectedLine: rejectedLine.trim() }),
    message: controllerErrorMessage(code, context, raw, rejectedLine, controllerKind),
  };
}
