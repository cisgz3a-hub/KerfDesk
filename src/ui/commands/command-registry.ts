// command-registry — the public command surface: id/type re-exports,
// buildAppCommands, lookup, and the run guard. Family builders live in
// command-families.ts; shared shapes in command-types.ts (ADR-015 split).

import {
  arrangeCommands,
  editCommands,
  fileCommands,
  helpCommand,
  laserCommands,
  toolsCommands,
  windowCommands,
} from './command-families';
import type { AppCommand, AppCommandContext, CommandId } from './command-types';

export { COMMAND_FAMILY_ORDER } from './command-types';
export type { AppCommand, AppCommandContext, CommandFamily, CommandId } from './command-types';

export function buildAppCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  return [
    ...fileCommands(ctx),
    ...editCommands(ctx),
    ...toolsCommands(ctx),
    ...arrangeCommands(ctx),
    ...laserCommands(ctx),
    ...windowCommands(ctx),
    helpCommand(ctx),
  ];
}

export function commandById(commands: ReadonlyArray<AppCommand>, id: CommandId): AppCommand {
  const command = commands.find((candidate) => candidate.id === id);
  if (command === undefined) throw new Error(`Missing command: ${id}`);
  return command;
}

export function runCommand(command: AppCommand): boolean {
  if (!command.enabled) return false;
  command.invoke();
  return true;
}
