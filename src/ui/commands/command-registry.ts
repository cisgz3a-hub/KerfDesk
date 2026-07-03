// command-registry — the public command surface: id/type re-exports,
// buildAppCommands, lookup, and the run guard. Family builders live in
// command-families.ts; shared shapes in command-types.ts (ADR-015 split).

import { fileCommands, helpCommand, toolsCommands, windowCommands } from './command-families';
import { editCommands } from './edit-command-family';
import { arrangeCommands } from './arrange-command-family';
import { laserCommands } from './laser-command-family';
import { gateCommandsForMachineKind } from './machine-command-gate';
import type { AppCommand, AppCommandContext, CommandId } from './command-types';

export { COMMAND_FAMILY_ORDER } from './command-types';
export type { AppCommand, AppCommandContext, CommandFamily, CommandId } from './command-types';

export function buildAppCommands(ctx: AppCommandContext): ReadonlyArray<AppCommand> {
  // ADR-101: hide laser-only commands in CNC mode at the single choke
  // point, so every command surface stays machine-correct for free.
  return gateCommandsForMachineKind(
    [
      ...fileCommands(ctx),
      ...editCommands(ctx),
      ...toolsCommands(ctx),
      ...arrangeCommands(ctx),
      ...laserCommands(ctx),
      ...windowCommands(ctx),
      helpCommand(ctx),
    ],
    ctx.machineKind,
  );
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
