import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUiStore } from '../state/ui-store';
import { commandHelpId, controlHelp } from '../help/help-topics';
import { handleWorkspaceContextKeyDown } from './workspace-context-keyboard';
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

  const position = useContextMenuPosition(state, barRef, moreOpen);
  if (state === null || position === null) return null;
  const primary = commandsForIds(primaryWorkspaceContextCommands(state.context), props.commands);
  const more = commandsForIds(moreWorkspaceContextCommands(state.context), props.commands);
  return (
    <div
      ref={barRef}
      role="menu"
      aria-orientation="vertical"
      aria-label="Workspace quick actions"
      className="lf-menu lf-workspace-context-menu"
      style={{ ...barStyle, ...position }}
      onKeyDown={handleWorkspaceContextKeyDown}
    >
      {primary.map((command) => (
        <ContextCommandButton key={command.id} command={command} onCommandRun={close} />
      ))}
      {more.length > 0 ? (
        <button
          type="button"
          role="menuitem"
          className="lf-menu-item"
          aria-expanded={moreOpen}
          title="Show more workspace commands"
          style={menuItemStyle}
          onClick={() => setMoreOpen((open) => !open)}
        >
          More
        </button>
      ) : null}
      {moreOpen ? (
        <div
          role="menu"
          aria-orientation="vertical"
          aria-label="More workspace quick actions"
          className="lf-workspace-context-menu__more"
          style={moreMenuStyle}
        >
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
      className="lf-menu-item"
      style={menuItemStyle}
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

type ContextMenuPosition = {
  readonly left: number;
  readonly top: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
};

/** Measure the actual rows before paint, including after More expands or the viewport changes. */
function useContextMenuPosition(
  state: { readonly x: number; readonly y: number } | null,
  menuRef: React.RefObject<HTMLDivElement | null>,
  expanded: boolean,
): ContextMenuPosition | null {
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (state === null || menu === null) return;
    const reposition = (): void => {
      const next = clampedPosition(state, menu.getBoundingClientRect());
      setPosition((previous) =>
        previous?.left === next.left &&
        previous.top === next.top &&
        previous.maxWidth === next.maxWidth &&
        previous.maxHeight === next.maxHeight
          ? previous
          : next,
      );
    };
    reposition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition);
    observer?.observe(menu);
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [state, menuRef, expanded]);
  return state === null ? null : (position ?? clampedPosition(state));
}

function clampedPosition(
  state: { readonly x: number; readonly y: number },
  bounds?: Pick<DOMRect, 'width' | 'height'>,
): ContextMenuPosition {
  const viewport = window.visualViewport ?? {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  };
  const maxWidth = Math.max(0, viewport.width - 2 * FLOATING_MARGIN_PX);
  const maxHeight = Math.max(0, viewport.height - 2 * FLOATING_MARGIN_PX);
  const size = bounds ?? { width: MENU_WIDTH_PX, height: 0 };
  const left = viewport.offsetLeft + FLOATING_MARGIN_PX;
  const top = viewport.offsetTop + FLOATING_MARGIN_PX;
  return {
    left: clamp(state.x, left, left + maxWidth - Math.min(size.width, maxWidth)),
    top: clamp(state.y, top, top + maxHeight - Math.min(size.height, maxHeight)),
    maxWidth,
    maxHeight,
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
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  document.addEventListener('keydown', closeOnEscapeKey, true);
  return () => document.removeEventListener('keydown', closeOnEscapeKey, true);
}

const FLOATING_MARGIN_PX = 8;
const MENU_WIDTH_PX = 240;

const barStyle: React.CSSProperties = {
  position: 'fixed',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 1,
  width: MENU_WIDTH_PX,
  overflowX: 'hidden',
  overflowY: 'auto',
  boxShadow: 'var(--lf-shadow)',
};

const menuItemStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '100%',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const moreMenuStyle: React.CSSProperties = {
  flexShrink: 0,
  position: 'static',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  marginTop: 2,
  paddingTop: 2,
  borderTop: '1px solid var(--lf-border)',
};
