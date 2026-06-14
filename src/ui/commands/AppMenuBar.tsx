import { useEffect, useRef, useState } from 'react';
import {
  COMMAND_FAMILY_ORDER,
  runCommand,
  type AppCommand,
  type CommandFamily,
} from './command-registry';

export function AppMenuBar(props: { readonly commands: ReadonlyArray<AppCommand> }): JSX.Element {
  const [openFamily, setOpenFamily] = useState<CommandFamily | null>(null);
  const menuBarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (openFamily === null) return;
    const closeOnOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && menuBarRef.current?.contains(target)) return;
      setOpenFamily(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
  }, [openFamily]);

  return (
    <nav ref={menuBarRef} aria-label="Application menu" style={menuBarStyle}>
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
        title={`Open the ${familyLabel(props.family)} menu.`}
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
      <div role="menu" className="lf-menu" style={menuStyle}>
        {commands.map((command) => (
          <button
            key={command.id}
            type="button"
            role="menuitem"
            className="lf-menu-item"
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
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text)',
  borderBottom: '1px solid var(--lf-border)',
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
// Surface chrome (background, border, hover) comes from .lf-menu /
// .lf-menu-item; these keep dropdown positioning + the two-column row.
const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  minWidth: 210,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};
const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
};
const shortcutStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 12,
  whiteSpace: 'nowrap',
};
