// console-command-ownership — when a Console command must wait for the
// controller exchange before it (ADR-362 §1; controller audit 2, ADR-375 C-5).
//
// GRBL-family firmware answers lines strictly in order, and an owned exchange
// takes the next terminal reply as its own. Only the M115 identity read waited
// for an earlier line's `ok`; an owned `$$` or `$n=` took that ok instead: a
// `$$` sent during a Console `$H` ended on the homing ok and reported an empty
// dump, and a `$30=` sent behind a `G4 P3` resolved on the dwell's ok, leaving
// its own error unattributed. `$X` is recovery and keeps no such wait.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L88-L104
import type { ControllerDriver } from '../../core/controllers';
import { isOwnedControllerIdentityCommand } from './console-command-transport';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import { hasPendingControllerWrite } from './laser-start-queue-fence';
import type { LaserState } from './laser-store';

type OwnedCommand = { readonly kind: string; readonly normalized: string };

export function consoleOwnershipBlockReason(
  state: LaserState,
  refs: Pick<ControllerLifecycleRefs, 'controllerCommand'> & { readonly driver: ControllerDriver },
  command: OwnedCommand,
): string | null {
  if (refs.controllerCommand !== null) return 'Wait for the current controller command to finish.';
  return consoleOwnedExchangeWaitReason(refs.driver, command, hasPendingControllerWrite(state));
}

/** The wait an owned Console exchange needs while an earlier write is still in
 *  transport or owes its acknowledgement, or null. A Console refusal of kind
 *  (c), handoff: the controller would take the line, but its reply could not be
 *  told apart from the earlier line's. */
export function consoleOwnedExchangeWaitReason(
  driver: ControllerDriver,
  command: OwnedCommand,
  earlierWritePending: boolean,
): string | null {
  if (!earlierWritePending) return null;
  const exchange = ownedExchange(driver, command);
  return exchange === null
    ? null
    : `Wait for the previous controller write and acknowledgement before ${exchange}.`;
}

function ownedExchange(driver: ControllerDriver, command: OwnedCommand): string | null {
  if (isOwnedControllerIdentityCommand({ driver }, command)) {
    return 'reading controller firmware identity';
  }
  if (command.kind === 'settings-query') return 'reading controller settings';
  if (command.kind === 'setting-write') return 'writing a controller setting';
  return null;
}
