// Toolbar - compact command buttons. Behavior comes from the app command
// registry so menu, toolbar, and future native-menu surfaces share handlers.

import { runCommand, type AppCommand, type CommandId } from '../commands/command-registry';

export function Toolbar(props: { readonly commands: ReadonlyArray<AppCommand> }): JSX.Element {
  return (
    <header aria-label="Toolbar" style={barStyle}>
      <span style={titleStyle}>LaserForge 2.0</span>
      <BuildBadge />
      <span style={separatorStyle} />
      <ToolbarButtons commands={props.commands} />
      <span style={separatorStyle} />
      <span style={hintStyle} title={SHORTCUT_HINT}>
        shortcuts
      </span>
    </header>
  );
}

function BuildBadge(): JSX.Element {
  const sha = __GIT_SHA__;
  const version = __APP_VERSION__;
  const builtAt = __BUILD_TIME__;
  const shortDate = builtAt.slice(0, 16).replace('T', ' ');
  const title = `Built ${builtAt}\nCommit ${sha}\nVersion ${version}`;
  return (
    <span style={buildBadgeStyle} title={title} aria-label="Build version">
      v{version} - {sha} - {shortDate} UTC
    </span>
  );
}

function ToolbarButtons(props: { readonly commands: ReadonlyArray<AppCommand> }): JSX.Element {
  return (
    <>
      {TOOLBAR_GROUPS.map((group, index) => (
        <ToolbarGroup key={index} commandIds={group} commands={props.commands} />
      ))}
    </>
  );
}

function ToolbarGroup(props: {
  readonly commandIds: ReadonlyArray<CommandId>;
  readonly commands: ReadonlyArray<AppCommand>;
}): JSX.Element {
  return (
    <>
      {props.commandIds.map((id) => {
        const command = props.commands.find((candidate) => candidate.id === id);
        return command === undefined ? null : <ToolbarButton key={id} command={command} />;
      })}
      <span style={separatorStyle} />
    </>
  );
}

function ToolbarButton(props: { readonly command: AppCommand }): JSX.Element {
  const title = props.command.disabledReason ?? toolbarTitle(props.command);
  return (
    <button
      type="button"
      title={title}
      disabled={!props.command.enabled}
      onClick={() => {
        runCommand(props.command);
      }}
    >
      {props.command.label}
    </button>
  );
}

function toolbarTitle(command: AppCommand): string {
  return command.shortcut === undefined ? command.title : `${command.title} (${command.shortcut})`;
}

const TOOLBAR_GROUPS: ReadonlyArray<ReadonlyArray<CommandId>> = [
  ['file.new', 'file.open', 'file.save', 'file.save-as'],
  [
    'file.import-svg',
    'tools.add-text',
    'file.import-image',
    'tools.trace-image',
    'tools.convert-to-bitmap',
    'file.save-gcode',
  ],
];

const SHORTCUT_HINT = [
  'File: Ctrl+N new - Ctrl+O open - Ctrl+S save - Ctrl+Shift+S save as - Ctrl+I import - Ctrl+E export G-code',
  'Edit: Ctrl+Z undo - Ctrl+Shift+Z redo - Ctrl+A select all - Delete/Backspace remove - Escape deselect',
  'Transform: arrows nudge 1mm - Shift+arrows 10mm - H flip horizontal - V flip vertical',
  'View: F or 0 fit-to-bed - +/- zoom - P preview - Space+drag pan',
].join('\n');

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  background: '#2c2c2c',
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  borderBottom: '1px solid #111',
};
const titleStyle: React.CSSProperties = { fontWeight: 600 };
const buildBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  fontFamily: 'ui-monospace, Menlo, monospace',
  cursor: 'help',
  userSelect: 'none',
};
const separatorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 1,
  height: 16,
  background: '#444',
  margin: '0 4px',
};
const hintStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  color: '#999',
  cursor: 'help',
  userSelect: 'none',
};
