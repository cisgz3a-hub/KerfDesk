// registration-command-family — the single Tools-menu / toolbar command for the
// registration jig (ADR-057): a toggle that opens or closes jig mode (ADR-634).
// Every actual jig action (create box, center artwork, pick the burn run) lives in
// jig mode itself, not in the command registry.

import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function registrationJigCommand(ctx: AppCommandContext): AppCommand {
  return {
    ...enabled(
      'tools.registration-jig',
      'tools',
      'Registration Jig',
      ctx.registrationPanelOpen
        ? 'Leave jig mode and return to the main canvas'
        : 'Open jig mode: lay out, place and burn the jig with the machine panel beside it',
      ctx.toggleRegistrationPanel,
    ),
    active: ctx.registrationPanelOpen,
  };
}
