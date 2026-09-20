// Toolbar commands retain the app registry's handlers, help and enabled state.
import { useState } from 'react';
import type { AppCommand } from '../commands/command-registry';
import type { MachineKind } from '../../core/scene';
import { useStore } from '../state';
import { ConnectionBadge } from './ConnectionBadge';
import { InstallButton } from './InstallButton';
import { ShortcutsDialog } from './ShortcutsDialog';
import { shortcutHint } from './shortcut-list';
import { ToolbarIcon } from './ToolbarIcon';
import { ToolbarCommands } from './ToolbarCommands';
import { WorkspaceLayoutSelect } from './WorkspaceLayoutSelect';
import { TutorialButton } from '../tutorials/TutorialButton';
import './Toolbar.css';

export function Toolbar(props: {
  readonly commands: ReadonlyArray<AppCommand>;
  readonly machineKind: MachineKind;
}): JSX.Element {
  const [isShortcutsOpen, setShortcutsOpen] = useState(false);
  return (
    <header aria-label="Toolbar" className="lf-toolbar-shell">
      <ToolbarCommands commands={props.commands} />
      <ToolbarProjectName />
      <div className="lf-toolbar-utilities">
        <ConnectionBadge />
        {/* Learn keeps its visible label: it is a destination, not a modifier,
            and the tutorial library is how a new operator finds everything the
            overflow popover hides. */}
        <TutorialButton label="Learn" />
        <WorkspaceLayoutSelect />
        <button
          type="button"
          className="lf-btn lf-btn--ghost lf-toolbar-command lf-toolbar-command--icon-only"
          aria-label="Keyboard Shortcuts"
          title={shortcutHint(props.machineKind)}
          onClick={() => setShortcutsOpen(true)}
        >
          <ToolbarIcon icon="shortcuts" />
        </button>
        {/* Install remains conditional on the browser's PWA install offer. */}
        <InstallButton />
      </div>
      {isShortcutsOpen ? (
        <ShortcutsDialog machineKind={props.machineKind} onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </header>
  );
}

function ToolbarProjectName(): JSX.Element {
  const savedName = useStore((state) => state.savedName);
  const dirty = useStore((state) => state.dirty);
  const name = savedName ?? 'Untitled project';
  return (
    <span
      className="lf-toolbar-project-name"
      title={dirty ? `${name} (unsaved changes)` : name}
      aria-label="Current project"
    >
      {name}
    </span>
  );
}
