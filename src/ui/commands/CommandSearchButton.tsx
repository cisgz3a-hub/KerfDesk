// A standing "Search" button in the menu bar for the command search (the bar
// also mounts the search window itself, since it already holds the commands). Ctrl+K
// and Help → Find a command… reach the same window, but a keyboard shortcut is
// invisible to a pointer-first operator, so the bar shows the way in. It sits
// outside the menubar nav for the same reason Undo / Redo do: a
// `role="menubar"` may only contain menuitems.

import { Icon } from '../kit';
import { commandHelpId, controlHelp } from '../help/help-topics';
import { openCommandSearch } from './command-search-store';

export function CommandSearchButton(): JSX.Element {
  const helpId = commandHelpId('help.find-command');
  return (
    <button
      type="button"
      className="lf-btn lf-btn--ghost lf-menu-search-button"
      aria-label="Find a command"
      aria-keyshortcuts="Control+K"
      title={`${controlHelp(helpId)} (Ctrl+K)`}
      data-help-id={helpId}
      onClick={openCommandSearch}
    >
      <Icon name="search" size={16} />
      <span className="lf-menu-search-button__label">Search</span>
      <kbd className="lf-menu-search-button__keys">Ctrl+K</kbd>
    </button>
  );
}
