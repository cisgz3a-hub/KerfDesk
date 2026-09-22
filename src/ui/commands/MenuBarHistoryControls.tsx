// Undo / Redo as standing menu-bar buttons, beside Help (ADR-348). Both
// actions existed only behind Edit → Undo and Ctrl+Z, which is a keyboard
// fact a pointer-first operator has no way to discover mid-edit.
//
// They render the registry's own `edit.undo` / `edit.redo` commands — same
// enablement, same titles, same handlers — so the buttons, the Edit menu and
// the shortcuts cannot disagree about whether there is anything to undo.
// Disabled rather than hidden, so the pair never reflows the menu bar.
//
// They sit OUTSIDE the menubar nav: a `role="menubar"` may only contain
// menuitems, and these are plain buttons that run on one click rather than
// opening anything.

import { Icon, type IconName } from '../kit';
import { commandHelpId, controlHelp } from '../help/help-topics';
import { runCommand, type AppCommand } from './command-registry';

export function MenuBarHistoryControls(props: {
  readonly commands: ReadonlyArray<AppCommand>;
}): JSX.Element | null {
  const undo = props.commands.find((command) => command.id === 'edit.undo');
  const redo = props.commands.find((command) => command.id === 'edit.redo');
  if (undo === undefined || redo === undefined) return null;
  return (
    <div role="group" aria-label="Edit history" className="lf-menu-history">
      <HistoryButton command={undo} icon="undo" />
      <HistoryButton command={redo} icon="redo" />
    </div>
  );
}

function HistoryButton(props: {
  readonly command: AppCommand;
  readonly icon: IconName;
}): JSX.Element {
  const { command } = props;
  const helpId = commandHelpId(command.id);
  return (
    <button
      type="button"
      className="lf-btn lf-btn--ghost lf-menu-history-button"
      aria-label={command.label}
      title={historyTitle(command)}
      data-help-id={helpId}
      disabled={!command.enabled}
      onClick={() => runCommand(command)}
    >
      <Icon name={props.icon} />
    </button>
  );
}

function historyTitle(command: AppCommand): string {
  if (command.disabledReason !== undefined)
    return controlHelp(commandHelpId(command.id), command.disabledReason);
  return command.shortcut === undefined ? command.title : `${command.title} (${command.shortcut})`;
}
