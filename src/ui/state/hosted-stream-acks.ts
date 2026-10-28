// Which drivers stream a job from a worker instead of the app window, and
// with which acknowledgement grammar (ADR-354, ADR-675). The window's thread
// also runs every edit, Undo, import and render, so a stall there stops the
// refill; under constant power the controller then stops with the beam lit.
//
// GRBL, grblHAL and FluidNC use GRBL's grammar. Marlin streams ping-pong on a
// plain `ok`. Smoothieware stays on the window: its beam goes dark when its
// queue runs dry in every power mode (rolling audit v6 K1), and its replies
// have not been ported to the worker.

import type { ControllerDriver } from '../../core/controllers';
import type { HostedStreamAcks } from '../../core/controllers/hosted-stream-acks';
import { isGrblFamilyDriver } from './laser-disconnect-transaction';

export function hostedStreamAcknowledgements(driver: ControllerDriver): HostedStreamAcks | null {
  if (isGrblFamilyDriver(driver)) return 'grbl';
  return driver.kind === 'marlin' ? 'marlin' : null;
}
