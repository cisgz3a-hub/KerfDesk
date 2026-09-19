import { Fragment, useCallback, useId, useRef, useState } from 'react';
import { runCommand, type AppCommand, type CommandId } from '../commands/command-registry';
import { commandHelpId, controlHelp } from '../help/help-topics';
import { AnchoredPopover, movePopoverFocus } from './AnchoredPopover';
import { ToolbarIcon } from './ToolbarIcon';
import { toolbarGroups, useToolbarOverflow } from './use-toolbar-overflow';

export function ToolbarCommands(props: {
  readonly commands: ReadonlyArray<AppCommand>;
}): JSX.Element {
  const layout = useToolbarOverflow(props.commands);
  return (
    <div ref={layout.containerRef} className="lf-toolbar-command-groups">
      {toolbarGroups(layout.primary, true).map((group, index) => (
        <Fragment key={group[0]?.id}>
          {index > 0 ? <ToolbarSeparator /> : null}
          {group.map((command) => (
            <ToolbarButton key={command.id} command={command} />
          ))}
        </Fragment>
      ))}
      {layout.overflow.length > 0 ? <ToolbarMore commands={layout.overflow} /> : null}
      <div ref={layout.measureRef} className="lf-toolbar-measure" aria-hidden="true">
        {toolbarGroups(props.commands)
          .flat()
          .map((command) => (
            <span
              key={command.id}
              data-measure-command={command.id}
              className={toolbarButtonClass(command.id)}
            >
              <ToolbarButtonContent command={command} />
            </span>
          ))}
        <span className="lf-btn lf-toolbar-command lf-toolbar-more" data-measure-more>
          <MoreContent />
        </span>
      </div>
    </div>
  );
}

function ToolbarMore(props: { readonly commands: ReadonlyArray<AppCommand> }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [initialFocus, setInitialFocus] = useState<string | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  const run = (command: AppCommand): void => {
    triggerRef.current?.focus();
    if (runCommand(command)) close();
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lf-btn lf-toolbar-command lf-toolbar-more"
        aria-label="More commands"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="More tools and file commands"
        onClick={() => {
          setInitialFocus(undefined);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          event.stopPropagation();
          setInitialFocus(event.key === 'ArrowUp' ? 'last' : undefined);
          setOpen(true);
        }}
      >
        <MoreContent />
      </button>
      {open ? (
        <AnchoredPopover
          id={menuId}
          label="More commands"
          role="menu"
          anchorRef={triggerRef}
          className="lf-toolbar-overflow"
          {...(initialFocus === undefined ? {} : { initialFocus })}
          onClose={close}
          onKeyDown={movePopoverFocus}
        >
          {toolbarGroups(props.commands).map((group, index) => (
            <Fragment key={group[0]?.id}>
              {index > 0 ? (
                <div role="separator" className="lf-toolbar-overflow-separator" />
              ) : null}
              {group.map((command) => (
                <OverflowCommand key={command.id} command={command} onRun={run} />
              ))}
            </Fragment>
          ))}
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function MoreContent(): JSX.Element {
  return (
    <>
      <ToolbarIcon icon="more" />
      <span>More</span>
    </>
  );
}

function OverflowCommand(props: {
  readonly command: AppCommand;
  readonly onRun: (command: AppCommand) => void;
}): JSX.Element {
  const { command } = props;
  return (
    <button
      type="button"
      role={command.active === undefined ? 'menuitem' : 'menuitemcheckbox'}
      className="lf-toolbar-overflow-command"
      aria-label={command.label}
      title={toolbarTitle(command)}
      data-help-id={commandHelpId(command.id)}
      disabled={!command.enabled}
      tabIndex={-1}
      {...(command.active === undefined ? {} : { 'aria-checked': command.active })}
      onClick={() => props.onRun(command)}
    >
      <ToolbarIcon icon={command.id} />
      <span className="lf-toolbar-command-label">{command.label}</span>
      {command.shortcut === undefined ? null : <kbd>{command.shortcut}</kbd>}
      {command.active === true ? <span aria-hidden="true">✓</span> : null}
    </button>
  );
}

function ToolbarButton(props: { readonly command: AppCommand }): JSX.Element {
  const { command } = props;
  return (
    <button
      type="button"
      className={toolbarButtonClass(command.id)}
      aria-label={command.label}
      title={toolbarTitle(command)}
      data-help-id={commandHelpId(command.id)}
      disabled={!command.enabled}
      {...(command.active === undefined ? {} : { 'aria-pressed': command.active })}
      onClick={() => runCommand(command)}
    >
      <ToolbarButtonContent command={command} />
    </button>
  );
}

function ToolbarButtonContent(props: { readonly command: AppCommand }): JSX.Element {
  return (
    <>
      <ToolbarIcon icon={props.command.id} />
      {!ICON_ONLY_TOOLBAR_COMMANDS.has(props.command.id) ? (
        <span className="lf-toolbar-command-label">{primaryLabel(props.command)}</span>
      ) : null}
    </>
  );
}

function primaryLabel(command: AppCommand): string {
  if (command.id === 'tools.add-text') return 'Text';
  if (command.id === 'tools.trace-image') return 'Trace image';
  if (command.id === 'tools.edit-image') return 'Image Studio';
  return command.label;
}

function toolbarButtonClass(id: CommandId): string {
  return ICON_ONLY_TOOLBAR_COMMANDS.has(id)
    ? 'lf-btn lf-toolbar-command lf-toolbar-command--icon-only'
    : 'lf-btn lf-toolbar-command';
}

function toolbarTitle(command: AppCommand): string {
  if (command.disabledReason !== undefined)
    return controlHelp(commandHelpId(command.id), command.disabledReason);
  return command.shortcut === undefined ? command.title : `${command.title} (${command.shortcut})`;
}

export function ToolbarSeparator(props: { readonly className?: string } = {}): JSX.Element {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      className={`lf-toolbar-separator ${props.className ?? ''}`}
    />
  );
}

const ICON_ONLY_TOOLBAR_COMMANDS = new Set<CommandId>([
  'file.new',
  'file.open',
  'file.save',
  'file.save-as',
  'file.import',
  'file.import-svg',
  'file.import-image',
  'file.save-gcode',
  'window.toggle-preview',
  'file.inspect-gcode',
]);
