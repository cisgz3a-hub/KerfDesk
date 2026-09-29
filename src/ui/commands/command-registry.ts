// command-registry — the public command surface: id/type re-exports,
// buildAppCommands, lookup, and the run guard. Family builders live in
// command-families.ts; shared shapes in command-types.ts (ADR-015 split).

import {
  connectionHelpCommand,
  fileCommands,
  helpCommand,
  safetyHelpCommand,
  toolsCommands,
  windowCommands,
} from './command-families';
import { discussionsCommand, reportBugCommand, licenceCommand } from './support-command-family';
import { tutorialsCommand } from './help-command-family';
import { editCommands } from './edit-command-family';
import { arrangeCommands } from './arrange-command-family';
import { laserCommands } from './laser-command-family';
import { gateCommandsForMachineKind } from './machine-command-gate';
import { gateCommandsForEdition } from './edition-command-gate';
import { commandUndoStepName } from './command-undo-step-name';
import { withUndoStepName } from '../state/undo-step-names';
import type { AppCommand, AppCommandContext, CommandId } from './command-types';

export { COMMAND_FAMILY_ORDER } from './command-types';
export type { AppCommand, AppCommandContext, CommandFamily, CommandId } from './command-types';

export function buildAppCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  // ADR-101: hide laser-only commands in CNC mode at the single choke
  // point, so every command surface stays machine-correct for free. The same
  // choke point sends the Pro commands through the edition check (ADR-540).
  const commands = gateCommandsForMachineKind(
    [
      ...fileCommands(ctx),
      ...editCommands(ctx),
      ...toolsCommands(ctx),
      ...arrangeCommands(ctx),
      ...laserCommands(ctx),
      ...windowCommands(ctx),
      helpCommand(ctx),
      tutorialsCommand(),
      safetyHelpCommand(ctx),
      connectionHelpCommand(ctx),
      reportBugCommand(),
      discussionsCommand(),
      ...(ctx.licensing === true ? [licenceCommand()] : []),
    ],
    ctx.machineKind,
  );
  return gateCommandsForEdition(commands);
}

export function commandById(commands: ReadonlyArray<AppCommand>, id: CommandId): AppCommand {
  const command = commands.find((candidate) => candidate.id === id);
  if (command === undefined) throw new Error(`Missing command: ${id}`);
  return command;
}

export function runCommand(command: AppCommand): boolean {
  if (!command.enabled) return false;
  withUndoStepName(commandUndoStepName(command), command.invoke);
  return true;
}
