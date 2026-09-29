// edition-command-gate — the Pro commands of the Free/Pro split (ADR-540).
// They stay listed and enabled in every edition: choosing one in KerfDesk Free
// shows the Pro dialog, which can unlock Pro and then run the command. A
// disabled command would never reach that dialog (runCommand skips it).

import { requestProFeature } from '../licensing/edition';
import { proChoiceLabel, type ProFeature } from '../licensing/pro-features';
import type { AppCommand, CommandId } from './command-types';

export const PRO_COMMAND_FEATURES: ReadonlyMap<CommandId, ProFeature> = new Map<
  CommandId,
  ProFeature
>([
  ['file.inspect-gcode', 'gcode-inspector'],
  ['file.open-gcode', 'gcode-inspector'],
  ['file.import-height-map', 'relief'],
  ['tools.box-generator', 'box-generator'],
  ['tools.multi-file-trace', 'advanced-trace'],
]);

export function gateCommandsForEdition(
  commands: ReadonlyArray<AppCommand>,
): ReadonlyArray<AppCommand> {
  return commands.map((command) => {
    const feature = PRO_COMMAND_FEATURES.get(command.id);
    if (feature === undefined) return command;
    const invoke = command.invoke;
    return { ...command, invoke: () => void requestProFeature(feature, invoke) };
  });
}

/** KerfDesk Free marks each Pro command, as it marks the Pro choices in lists. */
export function labelProCommands(commands: ReadonlyArray<AppCommand>): ReadonlyArray<AppCommand> {
  return commands.map((command) =>
    PRO_COMMAND_FEATURES.has(command.id)
      ? { ...command, label: proChoiceLabel(command.label, true) }
      : command,
  );
}
