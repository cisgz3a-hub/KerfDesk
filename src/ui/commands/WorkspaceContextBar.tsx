import { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../state/ui-store';
import { commandHelpId, controlHelp } from '../help/help-topics';
import { runCommand, type AppCommand, type CommandId } from './command-registry';
import {
  moreWorkspaceContextCommands,
  primaryWorkspaceContextCommands,
} from './workspace-context-commands';

export function WorkspaceContextBar(props: {
  readonly commands: ReadonlyArray<AppCommand>;
}): JSX.Element | null {
  const state = useUiStore((s) => s.workspaceContextBar);
  const close = useUiStore((s) => s.closeWorkspaceContextBar);
  const toolMode = useUiStore((s) => s.toolMode);
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const lastToolMode = useRef(toolMode);

  useEffect(() => setMoreOpen(false), [state]);
  useEffect(() => {
    if (state !== null) focusFirstEnabledButton(barRef.current);
  }, [state]);
  useEffect(() => {
    if (state === null) return;
    return closeOnOutsidePointerDown(barRef, close);
  }, [close, state]);
  useEffect(() => {
    if (state === null) return;
    return closeOnEscape(close);
  }, [close, state]);
  useEffect(() => {
    if (lastToolMode.current !== toolMode && state !== null) close();
    lastToolMode.current = toolMode;
  }, [close, state, toolMode]);

  const position = useMemo(() => (state === null ? null : clampedPosition(state)), [state]);
  if (state === null || position === null) return null;
  const primary = commandsForIds(primaryWorkspaceContextCommands(state.context), props.commands);
  const more = commandsForIds(moreWorkspaceContextCommands(state.context), props.commands);
  return (
    <div
      ref={barRef}
      role="menu"
      aria-label="Workspace quick actions"
      className="lf-menu"
      style={{ ...barStyle, left: position.left, top: position.top }}
    >
      {primary.map((command) => (
        <ContextCommandButton key={command.id} command={command} onCommandRun={close} />
      ))}
      {more.length > 0 ? (
        <button
          type="button"
          role="menuitem"
          className="lf-btn"
          aria-expanded={moreOpen}
          title="Show more workspace commands"
          style={moreButtonStyle}
          onClick={() => setMoreOpen((open) => !open)}
        >
          More
        </button>
      ) : null}
      {moreOpen ? (
        <div role="menu" className="lf-menu" style={moreMenuStyle}>
          {more.map((command) => (
            <ContextCommandButton key={command.id} command={command} onCommandRun={close} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ContextCommandButton(props: {
  readonly command: AppCommand;
  readonly onCommandRun: () => void;
}): JSX.Element {
  const helpId = commandHelpId(props.command.id);
  return (
    <button
      type="button"
      role="menuitem"
      className="lf-btn"
      disabled={!props.command.enabled}
      data-help-id={helpId}
      title={commandButtonTitle(props.command, helpId)}
      {...(props.command.active === undefined ? {} : { 'aria-pressed': props.command.active })}
      onClick={() => {
        if (runCommand(props.command)) props.onCommandRun();
      }}
    >
      {props.command.label}
    </button>
  );
}

function commandButtonTitle(command: AppCommand, helpId: ReturnType<typeof commandHelpId>): string {
  if (command.disabledReason !== undefined) return controlHelp(helpId, command.disabledReason);
  return command.shortcut === undefined ? command.title : `${command.title} (${command.shortcut})`;
}

function commandsForIds(
  ids: ReadonlyArray<CommandId>,
  commands: ReadonlyArray<AppCommand>,
): ReadonlyArray<AppCommand> {
  const byId = new Map(commands.map((command) => [command.id, command]));
  return ids.flatMap((id) => {
    const command = byId.get(id);
    return command === undefined ? [] : [command];
  });
}

function clampedPosition(state: {
  readonly x: number;
  readonly y: number;
}): { readonly left: number; readonly top: number } {
  return {
    left: clamp(state.x, FLOATING_MARGIN_PX, window.innerWidth - BAR_WIDTH_PX),
    top: clamp(state.y, FLOATING_MARGIN_PX, window.innerHeight - BAR_HEIGHT_PX),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function focusFirstEnabledButton(node: HTMLDivElement | null): void {
  const button = node?.querySelector('button:not(:disabled)');
  if (button instanceof HTMLButtonElement) button.focus();
}

function closeOnOutsidePointerDown(
  barRef: React.RefObject<HTMLDivElement | null>,
  close: () => void,
): () => void {
  const closeOnOutsidePointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && barRef.current?.contains(target)) return;
    close();
  };
  document.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
  return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
}

function closeOnEscape(close: () => void): () => void {
  const closeOnEscapeKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', closeOnEscapeKey, true);
  return () => document.removeEventListener('keydown', closeOnEscapeKey, true);
}

const FLOATING_MARGIN_PX = 8;
const BAR_WIDTH_PX = 420;
const BAR_HEIGHT_PX = 44;

const barStyle: React.CSSProperties = {
  position: 'fixed',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: BAR_WIDTH_PX,
  overflowX: 'auto',
  boxShadow: 'var(--lf-shadow)',
};

const moreButtonStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
};

const moreMenuStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 'calc(100% + 4px)',
  minWidth: 230,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
};
