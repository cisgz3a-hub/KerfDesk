// live-motion-unowned — the Live Motion bar's words for motion the controller
// reports with no owner here (unowned-controller-motion.ts; controller audit 2,
// ADR-375 C-2). A Console G1, `$J=` or `$H` left the bar empty, so Disconnect
// was the only software stop. Deliberately no Resume, as for a controller hold
// during a job: releasing a hold KerfDesk never requested stays with cycle
// start, and Abort clears it with a reset (unowned-motion-stop.ts).

import type { UnownedControllerMotion } from '../state/unowned-controller-motion';
import type { UnownedControllerOutput } from '../state/unowned-controller-output';

type ControllerHold = { readonly state: 'Hold' | 'Door'; readonly doorPin: boolean } | null;

export type UnownedMotionDescription = {
  readonly heading: string;
  readonly detail: string;
  readonly abortLabel: 'ABORT MOTION' | 'LASER OFF';
};

// Most hobby lasers have no cycle-start button, so the bar's own ABORT MOTION
// is named as the way out (UX audit U5-P3-5).
const HOLD_RELEASE =
  "Release it with the machine's cycle-start button if it has one, or press ABORT MOTION here to clear it with a controller reset";

/** Motion first: the output report is Idle-only, so the two never coincide. */
export function describeUnowned(
  motion: UnownedControllerMotion | null,
  output: UnownedControllerOutput | null,
  hold: ControllerHold,
  homingStateStuck: boolean,
): UnownedMotionDescription | null {
  if (motion !== null) return describeUnownedMotion(motion, hold, homingStateStuck);
  return output === null ? null : describeUnownedOutput(output);
}

// A laser left on at Idle by a Console M3 or a file that ends lit (rolling
// audit v5 J2-P2-1). LASER OFF sends M5, with M9 when air is on too, and no
// reset, so the work origin and position stay.
function describeUnownedOutput(output: UnownedControllerOutput): UnownedMotionDescription {
  return {
    heading: 'LASER ON',
    detail:
      output === 'laser-and-air'
        ? 'The controller reports the laser and air assist on at Idle, which nothing here turned on, such as a Console M3 or a file that ended without M5'
        : 'The controller reports the laser on at Idle, which nothing here turned on, such as a Console M3 or a file that ended without M5',
    abortLabel: 'LASER OFF',
  };
}

function describeUnownedMotion(
  motion: UnownedControllerMotion,
  hold: ControllerHold,
  homingStateStuck = false,
): UnownedMotionDescription {
  switch (motion) {
    case 'Run':
      return unowned(
        'MACHINE MOVING',
        'The controller reports motion no job or operation here started, such as a Console command',
      );
    case 'Jog':
      return unowned(
        'JOGGING',
        'The controller reports a jog no operation here started, such as a Console $J= command',
      );
    case 'Home':
      // Stock GRBL that refused a single-axis Home reports Home with no cycle
      // running until a reset; the Alarm banner explains it (ADR-375 A-7).
      return homingStateStuck
        ? unowned(
            'HOMING STATE',
            'The controller reports Home with no homing cycle running, as stock GRBL does after refusing a single-axis Home such as $HX. Abort clears it with a controller reset',
          )
        : unowned(
            'HOMING',
            'The controller reports a homing cycle no operation here started. Abort stops it with a controller reset',
          );
    case 'Hold':
      return unowned(
        'CONTROLLER HOLD',
        `The controller is holding motion no job here started. ${HOLD_RELEASE}`,
      );
    case 'Door':
      // GRBL re-enters its door state after a reset while the input stays open.
      // https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L56-L60
      return unowned(
        'CONTROLLER DOOR HOLD',
        hold?.doorPin === true
          ? "The controller reports its door or lid input open and has stopped motion. Close it, then press the machine's cycle-start button if it has one, or ABORT MOTION here to clear it with a controller reset"
          : `The controller paused when its door or lid input opened, and stays paused after it closes. ${HOLD_RELEASE}`,
      );
  }
}

function unowned(heading: string, detail: string): UnownedMotionDescription {
  return { heading, detail, abortLabel: 'ABORT MOTION' };
}
