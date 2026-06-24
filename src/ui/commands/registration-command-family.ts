// registration-command-family — the single Tools-menu / toolbar command for the
// registration jig (ADR-057): a toggle that opens or closes the floating jig panel.
// Every actual jig action (create box, center artwork, pick the burn run) lives in
// the panel itself (RegistrationJigPanel), not in the command registry.

import { enabled, type AppCommand, type AppCommandContext } from './command-types';

export function registrationJigCommand(ctx: AppCommandContext): AppCommand {
  return {
    ...enabled(
      'tools.registration-jig',
      'tools',
      'Registration Jig',
      ctx.registrationPanelOpen
        ? 'Close the registration jig panel'
        : 'Open the registration jig panel — burn-aligned box placement',
      ctx.toggleRegistrationPanel,
    ),
    active: ctx.registrationPanelOpen,
  };
}
