import { useState } from 'react';
import {
  COMMAND_FAMILY_ORDER,
  runCommand,
  type AppCommand,
  type CommandFamily,
} from './command-registry';

export function AppMenuBar(props: { readonly commands: ReadonlyArray<AppCommand> }): JSX.Element {
  const [openFamily, setOpenFamily] = useState<CommandFamily | null>(null);
  return (
    <nav aria-label="Application menu" style={menuBarStyle}>
      {COMMAND_FAMILY_ORDER.map((family) => (
        <MenuFamily
          key={family}
          family={family}
          commands={props.commands}
          open={openFamily === family}
          onOpenChange={(open) =>
            setOpenFamily((current) => {
              if (open) return family;
              return current === family ? null : current;
            })
          }
          onCommandRun={() => setOpenFamily(null)}
        />
      ))}
    </nav>
  );
}

function MenuFamily(props: {
  readonly family: CommandFamily;
  readonly commands: ReadonlyArray<AppCommand>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCommandRun: () => void;
}): JSX.Element | null {
  const commands = props.commands.filter((command) => command.family === props.family);
  if (commands.length === 0) return null;
  const toggle = (): void => props.onOpenChange(!props.open);
  return (
    <details open={props.open} style={familyStyle}>
      <summary
        style={summaryStyle}
        onClick={(event) => {
          event.preventDefault();
          toggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        }}
      >
        {familyLabel(props.family)}
      </summary>
      <div role="menu" style={menuStyle}>
        {commands.map((command) => (
          <button
            key={command.id}
            type="button"
            role="menuitem"
            disabled={!command.enabled}
            title={command.disabledReason ?? command.title}
            style={menuItemStyle}
            onClick={() => {
              if (runCommand(command)) props.onCommandRun();
            }}
          >
            <span>{command.label}</span>
            {command.shortcut !== undefined ? (
              <span style={shortcutStyle}>{command.shortcut}</span>
            ) : null}
          </button>
        ))}
      </div>
    </details>
  );
}

function familyLabel(family: CommandFamily): string {
  switch (family) {
    case 'file':
      return 'File';
    case 'edit':
      return 'Edit';
    case 'tools':
      return 'Tools';
    case 'arrange':
      return 'Arrange';
    case 'laser':
      return 'Laser';
    case 'window':
      return 'Window';
    case 'help':
      return 'Help';
  }
}

const menuBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 2,
  padding: '2px 8px',
  background: '#1f2933',
  color: '#e5e7eb',
  borderBottom: '1px solid #111827',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  position: 'relative',
  zIndex: 20,
};
const familyStyle: React.CSSProperties = { position: 'relative' };
const summaryStyle: React.CSSProperties = {
  listStyle: 'none',
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: 4,
  userSelect: 'none',
};
const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  minWidth: 210,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: 4,
  background: '#f8fafc',
  color: '#111827',
  border: '1px solid #cbd5e1',
  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.22)',
};
const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  width: '100%',
  padding: '5px 8px',
  border: 0,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'left',
  font: 'inherit',
  cursor: 'pointer',
};
const shortcutStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: 12,
  whiteSpace: 'nowrap',
};
