// Toolbar - compact command buttons. Behavior comes from the app command
// registry so menu, toolbar, and future native-menu surfaces share handlers.

import { Fragment, useState } from 'react';
import { runCommand, type AppCommand, type CommandId } from '../commands/command-registry';
import { commandHelpId, controlHelp } from '../help/help-topics';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import type { MachineKind } from '../../core/scene';
import { ConnectionBadge } from './ConnectionBadge';
import { InstallButton } from './InstallButton';
import { ShortcutsDialog } from './ShortcutsDialog';
import { shortcutHint } from './shortcut-list';
import { ToolbarIcon } from './ToolbarIcon';

export function Toolbar(props: {
  readonly commands: ReadonlyArray<AppCommand>;
  readonly machineKind: MachineKind;
}): JSX.Element {
  const [isShortcutsOpen, setShortcutsOpen] = useState(false);
  return (
    <header aria-label="Toolbar" style={barStyle}>
      <span className="lf-toolbar-brand" style={titleStyle}>
        {APP_DISPLAY_NAME}
      </span>
      <BuildBadge />
      <ConnectionBadge />
      <ToolbarSeparator className="lf-toolbar-identity-separator" />
      <ToolbarButtons commands={props.commands} />
      {/* No separator before the hint: margin-left auto already isolates it,
          and a lone rule floating in the stretch of empty bar looked stray. */}
      <button
        type="button"
        className="lf-btn lf-btn--ghost lf-toolbar-command lf-toolbar-command--icon-only"
        style={hintStyle}
        aria-label="Keyboard Shortcuts"
        title={shortcutHint(props.machineKind)}
        onClick={() => setShortcutsOpen(true)}
      >
        <ToolbarIcon icon="shortcuts" />
      </button>
      {/* InstallButton renders only when the browser offers a PWA install
          prompt (beforeinstallprompt), so it stays hidden until installable
          and disappears once installed. DownloadDesktopLink remains unmounted
          (maintainer request 2026-07-07); it can be restored the same way. */}
      <InstallButton />
      {isShortcutsOpen ? (
        <ShortcutsDialog machineKind={props.machineKind} onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </header>
  );
}

function BuildBadge(): JSX.Element {
  const sha = __GIT_SHA__;
  const version = __APP_VERSION__;
  const builtAt = __BUILD_TIME__;
  const title = `Built ${builtAt}\nCommit ${sha}\nVersion ${version}`;
  // Visible badge stays short (version + sha are what deploy checks compare);
  // the build timestamp lives in the hover title so the toolbar's full button
  // set still fits a single row on a 1512px-wide window.
  return (
    <span
      className="lf-toolbar-build"
      style={buildBadgeStyle}
      title={title}
      aria-label="Build version"
    >
      v{version} - {sha}
    </span>
  );
}

function ToolbarButtons(props: { readonly commands: ReadonlyArray<AppCommand> }): JSX.Element {
  // Separators go between non-empty groups only: a trailing separator per
  // group used to stack into a stray "| |" next to the structural separator
  // whenever the last groups had no registered commands.
  const visibleGroups = TOOLBAR_GROUPS.map((group) =>
    group
      .map((id) => props.commands.find((candidate) => candidate.id === id))
      .filter((command): command is AppCommand => command !== undefined),
  ).filter((group) => group.length > 0);
  return (
    <div className="lf-toolbar-command-groups">
      {visibleGroups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 ? <ToolbarSeparator /> : null}
          {group.map((command) => (
            <ToolbarButton key={command.id} command={command} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function ToolbarSeparator(props: { readonly className?: string } = {}): JSX.Element {
  const className =
    props.className === undefined
      ? 'lf-toolbar-separator'
      : `lf-toolbar-separator ${props.className}`;
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      style={separatorStyle}
      className={className}
    />
  );
}

function ToolbarButton(props: { readonly command: AppCommand }): JSX.Element {
  const helpId = commandHelpId(props.command.id);
  const title =
    props.command.disabledReason === undefined
      ? toolbarTitle(props.command)
      : controlHelp(helpId, props.command.disabledReason);
  return (
    <button
      type="button"
      className={toolbarButtonClass(props.command.id)}
      aria-label={props.command.label}
      title={title}
      data-help-id={helpId}
      disabled={!props.command.enabled}
      {...(props.command.active === undefined ? {} : { 'aria-pressed': props.command.active })}
      onClick={() => {
        runCommand(props.command);
      }}
    >
      <ToolbarIcon icon={props.command.id} />
      {!ICON_ONLY_TOOLBAR_COMMANDS.has(props.command.id) ? (
        <span className="lf-toolbar-command-label">{props.command.label}</span>
      ) : null}
    </button>
  );
}

function toolbarButtonClass(id: CommandId): string {
  return ICON_ONLY_TOOLBAR_COMMANDS.has(id)
    ? 'lf-btn lf-toolbar-command lf-toolbar-command--icon-only'
    : 'lf-btn lf-toolbar-command';
}

function toolbarTitle(command: AppCommand): string {
  return command.shortcut === undefined ? command.title : `${command.title} (${command.shortcut})`;
}

// Groups are ordered by workflow: project files, bring artwork in, create
// artwork, transform artwork, export, verify. The old second group mixed
// import/create/trace/export into one run of seven buttons.
const TOOLBAR_GROUPS: ReadonlyArray<ReadonlyArray<CommandId>> = [
  ['file.new', 'file.open', 'file.save', 'file.save-as'],
  ['file.import-svg', 'file.import-image'],
  [
    'tools.add-text',
    'tools.registration-jig',
    'tools.camera',
    'tools.place-board',
    'tools.box-generator',
  ],
  ['tools.trace-image', 'tools.edit-image', 'tools.convert-to-bitmap'],
  ['file.save-gcode'],
  // M27: Preview is the operator's primary pre-burn verification surface —
  // it gets a visible toggle, not just the P shortcut.
  ['window.toggle-preview'],
];

const ICON_ONLY_TOOLBAR_COMMANDS = new Set<CommandId>([
  'file.new',
  'file.open',
  'file.save',
  'file.save-as',
  'file.import-svg',
  'file.import-image',
  'file.save-gcode',
  'window.toggle-preview',
]);

const barStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'nowrap',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text)',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  borderBottom: '1px solid var(--lf-border)',
  overflow: 'hidden',
};
const titleStyle: React.CSSProperties = { fontWeight: 600 };
const buildBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-faint)',
  fontFamily: 'ui-monospace, Menlo, monospace',
  cursor: 'help',
  userSelect: 'none',
};
const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: 'var(--lf-border-strong)',
};
const hintStyle: React.CSSProperties = {
  marginLeft: 'auto',
  flexShrink: 0,
};
