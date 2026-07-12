import { Fragment } from 'react';
import type { MachineKind } from '../../core/scene';
import { machineDisplayName } from '../machine/machine-labels';
import {
  COMMAND_FAMILY_ORDER,
  runCommand,
  type AppCommand,
  type CommandFamily,
  type CommandId,
} from './command-registry';
import { commandHelpId, controlHelp, menuHelpId } from '../help/help-topics';
import { handleMenuKeyDown } from './menu-keyboard';
import { useMenuBarState } from './use-menu-bar-state';

export function AppMenuBar(props: {
  readonly commands: ReadonlyArray<AppCommand>;
  readonly machineKind: MachineKind;
}): JSX.Element {
  const menu = useMenuBarState();

  return (
    <nav
      ref={menu.menuBarRef}
      role="menubar"
      aria-label="Application menu"
      style={menuBarStyle}
      onKeyDown={(event) =>
        handleMenuKeyDown(event, {
          root: menu.menuBarRef.current,
          openFamily: menu.openFamily,
          setOpenFamily: menu.setOpenFamily,
          setFocusedFamily: menu.setFocusedFamily,
          pendingMenuFocus: menu.pendingMenuFocus,
          pendingFamilyReturn: menu.pendingFamilyReturn,
        })
      }
    >
      {COMMAND_FAMILY_ORDER.map((family) => (
        <MenuFamily
          key={family}
          family={family}
          machineKind={props.machineKind}
          commands={props.commands}
          open={menu.openFamily === family}
          tabIndex={menu.focusedFamily === family ? 0 : -1}
          onFocus={() => menu.setFocusedFamily(family)}
          onOpenChange={(open) =>
            menu.setOpenFamily((current) => {
              if (open) return family;
              return current === family ? null : current;
            })
          }
          onCommandRun={() => menu.setOpenFamily(null)}
        />
      ))}
    </nav>
  );
}

function MenuFamily(props: {
  readonly family: CommandFamily;
  readonly machineKind: MachineKind;
  readonly commands: ReadonlyArray<AppCommand>;
  readonly open: boolean;
  readonly tabIndex: number;
  readonly onFocus: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCommandRun: () => void;
}): JSX.Element | null {
  const commands = props.commands.filter((command) => command.family === props.family);
  if (commands.length === 0) return null;
  const toggle = (): void => props.onOpenChange(!props.open);
  const familyHelpId = menuHelpId(props.family);
  return (
    <details open={props.open} style={familyStyle} data-menu-family={props.family}>
      <summary
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={props.open}
        tabIndex={props.tabIndex}
        data-menu-family-summary={props.family}
        style={summaryStyle}
        title={controlHelp(familyHelpId)}
        data-help-id={familyHelpId}
        onClick={(event) => {
          event.preventDefault();
          toggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggle();
        }}
        onFocus={props.onFocus}
      >
        {familyLabel(props.family, props.machineKind)}
      </summary>
      {props.open ? (
        <div role="menu" className="lf-menu" style={menuStyle} data-family-menu={props.family}>
          {groupCommands(props.family, commands).map((group, index) => (
            <Fragment key={index}>
              {index > 0 ? <div role="separator" style={menuSeparatorStyle} /> : null}
              <div role="group" aria-label={group.label}>
                {group.label === undefined ? null : (
                  <div style={menuGroupLabelStyle}>{group.label}</div>
                )}
                {group.commands.map((command) => (
                  <MenuItem key={command.id} command={command} onCommandRun={props.onCommandRun} />
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function MenuItem(props: {
  readonly command: AppCommand;
  readonly onCommandRun: () => void;
}): JSX.Element {
  const command = props.command;
  const commandHelp = commandHelpId(command.id);
  return (
    <button
      type="button"
      role="menuitem"
      className="lf-menu-item"
      disabled={!command.enabled}
      title={controlHelp(commandHelp, command.disabledReason)}
      data-help-id={commandHelp}
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
  );
}

// Presentation-only grouping: separators render between these blocks, in this
// order. Commands a family registers that are NOT listed here fall into a
// trailing block — grouping must never hide a command.
type MenuGroupLayout = { readonly label: string; readonly ids: ReadonlyArray<CommandId> };

const MENU_GROUPS: Partial<Record<CommandFamily, ReadonlyArray<MenuGroupLayout>>> = {
  tools: [
    {
      label: 'Create & measure',
      ids: [
        'tools.measure',
        'tools.add-text',
        'tools.registration-jig',
        'tools.camera',
        'tools.place-board',
        'tools.box-generator',
      ],
    },
    {
      label: 'Calibrate',
      ids: [
        'tools.material-test',
        'tools.interval-test',
        'tools.scan-offset-test',
        'tools.focus-test',
      ],
    },
    { label: 'Settings', ids: ['tools.optimization-settings'] },
    {
      label: 'Image',
      ids: [
        'tools.adjust-image',
        'tools.apply-image-mask',
        'tools.crop-image',
        'tools.remove-image-mask',
        'tools.save-processed-bitmap',
      ],
    },
    {
      label: 'Trace',
      ids: ['tools.trace-image', 'tools.retrace-original', 'tools.multi-file-trace'],
    },
    {
      label: 'Vector',
      ids: [
        'tools.convert-to-path',
        'tools.weld',
        'tools.subtract',
        'tools.intersect',
        'tools.exclude',
      ],
    },
    {
      label: 'Fill repair',
      ids: [
        'tools.fill-selection',
        'tools.close-open-fill-contours',
        'tools.close-fill-contours-with-tolerance',
      ],
    },
    { label: 'Bitmap', ids: ['tools.convert-to-bitmap'] },
  ],
};

function groupCommands(
  family: CommandFamily,
  commands: ReadonlyArray<AppCommand>,
): ReadonlyArray<{ readonly label?: string; readonly commands: ReadonlyArray<AppCommand> }> {
  const layout = MENU_GROUPS[family];
  if (layout === undefined) return [{ commands }];
  const grouped = layout.map((group) => ({
    label: group.label,
    commands: group.ids
      .map((id) => commands.find((command) => command.id === id))
      .filter((command): command is AppCommand => command !== undefined),
  }));
  const placed = new Set(layout.flatMap((group) => group.ids));
  const leftovers = commands.filter((command) => !placed.has(command.id));
  return [...grouped, { label: 'Other', commands: leftovers }].filter(
    (group) => group.commands.length > 0,
  );
}

function familyLabel(family: CommandFamily, machineKind: MachineKind): string {
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
      // The family KEY stays 'laser' (ADR-101 §7); only the visible label
      // follows the machine kind.
      return machineDisplayName(machineKind);
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
  // Long menus (Tools is 25 items) must scroll instead of running off the
  // bottom of short windows; 80px ≈ menu bar + toolbar above the dropdown.
  maxHeight: 'calc(100vh - 80px)',
  overflowY: 'auto',
};
const menuSeparatorStyle: React.CSSProperties = {
  height: 1,
  flexShrink: 0,
  background: 'var(--lf-border)',
  margin: '3px 6px',
};
const menuGroupLabelStyle: React.CSSProperties = {
  padding: '5px 9px 2px',
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
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
