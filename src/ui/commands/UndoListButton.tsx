// The Undo list: a drop-down arrow beside the menu bar's Undo button that shows
// the last 15 steps by name, newest first (Rayforge comparison). Picking a step
// undoes back to just before it; each undone step goes onto the redo stack, so
// Redo then walks forward again one step at a time.
//
// It lives beside the Undo button rather than as an Edit submenu because the
// menu bar has no submenus, and the button is where Office, Photoshop and
// Inkscape users look for it. Window → Undo History shows all 50 steps, and
// redo steps too, and jumps the same way.

import { useCallback, useId, useRef, useState } from 'react';
import { AnchoredPopover, movePopoverFocus } from '../common/AnchoredPopover';
import { Icon } from '../kit';
import { useStore } from '../state/store';
import {
  UNDO_LIST_LENGTH,
  undoHistoryEntries,
  undoSteps,
  type UndoHistoryEntry,
} from '../state/undo-history';

export function UndoListButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const empty = useStore((state) => state.undoStack.length === 0);
  const close = useCallback(() => setOpen(false), []);
  const choose = (steps: number): void => {
    close();
    anchorRef.current?.focus();
    undoSteps(steps);
  };
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="lf-btn lf-btn--ghost lf-menu-history-button"
        style={caretStyle}
        aria-label="Undo list"
        aria-haspopup="menu"
        aria-expanded={open && !empty}
        aria-controls={open && !empty ? menuId : undefined}
        title={
          empty
            ? 'Undo list: nothing to undo.'
            : `Undo list: the last ${UNDO_LIST_LENGTH} steps by name. Pick one to undo back to just before it.`
        }
        disabled={empty}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="chevron-down" size={12} />
      </button>
      {open && !empty ? (
        <AnchoredPopover
          id={menuId}
          label="Undo list"
          role="menu"
          anchorRef={anchorRef}
          onClose={close}
          onKeyDown={movePopoverFocus}
        >
          <UndoListItems onChoose={choose} />
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function UndoListItems(props: { readonly onChoose: (steps: number) => void }): JSX.Element {
  const project = useStore((state) => state.project);
  const undoStack = useStore((state) => state.undoStack);
  const redoStack = useStore((state) => state.redoStack);
  const entries = undoHistoryEntries({ project, undoStack, redoStack }, UNDO_LIST_LENGTH);
  const older = undoStack.length - entries.length;
  return (
    <div style={listStyle}>
      {entries.map((entry) => (
        <button
          key={entry.steps}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="lf-menu-item"
          title={entryTitle(entry)}
          data-undo-steps={entry.steps}
          onClick={() => props.onChoose(entry.steps)}
        >
          <span style={nameStyle}>{entry.name}</span>
          {entry.steps > 1 ? <span style={countStyle}>{entry.steps} steps</span> : null}
        </button>
      ))}
      {older > 0 ? (
        <p style={olderStyle}>
          {older} older {older === 1 ? 'step is' : 'steps are'} in Window → Undo History.
        </p>
      ) : null}
    </div>
  );
}

function entryTitle(entry: UndoHistoryEntry): string {
  return entry.steps === 1
    ? `Undo ${entry.name}.`
    : `Undo ${entry.name} and the ${entry.steps - 1} ${entry.steps === 2 ? 'step' : 'steps'} after it. Redo brings them back.`;
}

const caretStyle: React.CSSProperties = { width: 16, marginLeft: -2 };
const listStyle: React.CSSProperties = { display: 'grid', minWidth: 220, maxWidth: 360 };
const nameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const countStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 12,
  whiteSpace: 'nowrap',
};
const olderStyle: React.CSSProperties = {
  margin: '4px 10px 2px',
  color: 'var(--lf-text-faint)',
  fontSize: 12,
};
