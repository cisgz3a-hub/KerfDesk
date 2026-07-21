// Selection controls for the options bar (ADR-242, PP-B): the four sticky
// Photoshop boolean-mode buttons (Shift/Alt while dragging are the transient
// equivalents), the Select ▸ Modify row (Expand/Contract/Border/Smooth/
// Feather by a px amount), and the selection action buttons.

import { useState } from 'react';
import { invertMask, type SelectionCombineMode } from '../../core/image-select';
import type { SelectionModifyKind } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

const MODES: readonly {
  readonly mode: SelectionCombineMode;
  readonly glyph: string;
  readonly label: string;
}[] = [
  { mode: 'replace', glyph: '□', label: 'New selection' },
  { mode: 'add', glyph: '⊞', label: 'Add to selection (Shift while dragging)' },
  { mode: 'subtract', glyph: '⊟', label: 'Subtract from selection (Alt while dragging)' },
  { mode: 'intersect', glyph: '⊡', label: 'Intersect with selection (Shift+Alt while dragging)' },
];

const MODIFY_KINDS: readonly { readonly kind: SelectionModifyKind; readonly label: string }[] = [
  { kind: 'expand', label: 'Expand' },
  { kind: 'contract', label: 'Contract' },
  { kind: 'border', label: 'Border' },
  { kind: 'smooth', label: 'Smooth' },
  { kind: 'feather', label: 'Feather' },
];

export function SelectionModeButtons(): JSX.Element {
  const selectionMode = useImageEditorStore((s) => s.selectionMode);
  const setSelectionMode = useImageEditorStore((s) => s.setSelectionMode);
  const feather = useImageEditorStore((s) => s.selectionFeather);
  const setSelectionFeather = useImageEditorStore((s) => s.setSelectionFeather);
  return (
    <span style={groupStyle} aria-label="Selection mode">
      {MODES.map((entry) => (
        <button
          key={entry.mode}
          type="button"
          onClick={() => setSelectionMode(entry.mode)}
          aria-pressed={selectionMode === entry.mode}
          title={entry.label}
          style={{
            ...modeButtonStyle,
            ...(selectionMode === entry.mode ? activeModeStyle : null),
          }}
        >
          <span aria-hidden="true">{entry.glyph}</span>
        </button>
      ))}
      <label style={radiusLabelStyle}>
        Feather
        <input
          type="number"
          min={0}
          max={250}
          value={feather}
          onChange={(e) => setSelectionFeather(Number(e.target.value) || 0)}
          style={radiusInputStyle}
          title="Soft-edge every new selection by this many pixels"
          aria-label="Selection feather in pixels"
        />
      </label>
    </span>
  );
}

export function SelectionModifyRow(): JSX.Element | null {
  const hasSelection = useImageEditorStore((s) => s.session?.selection != null);
  const modifySelection = useImageEditorStore((s) => s.modifySelection);
  const [radius, setRadius] = useState(2);
  if (!hasSelection) return null;
  return (
    <span style={groupStyle} aria-label="Modify selection">
      <label style={radiusLabelStyle}>
        px
        <input
          type="number"
          min={1}
          max={250}
          value={radius}
          onChange={(e) => setRadius(Math.max(1, Math.min(250, Number(e.target.value) || 1)))}
          style={radiusInputStyle}
          title="Pixel amount for the Modify operations"
          aria-label="Modify amount in pixels"
        />
      </label>
      {MODIFY_KINDS.map((entry) => (
        <button
          key={entry.kind}
          type="button"
          className="lf-btn"
          style={smallButtonStyle}
          onClick={() => modifySelection(entry.kind, radius)}
          title={`${entry.label} the selection by ${radius} px (Select ▸ Modify)`}
        >
          {entry.label}
        </button>
      ))}
    </span>
  );
}

export function SelectionActions(): JSX.Element {
  const session = useImageEditorStore((s) => s.session);
  const deleteSelection = useImageEditorStore((s) => s.deleteSelection);
  const fillSelection = useImageEditorStore((s) => s.fillSelection);
  const select = useImageEditorStore((s) => s.select);
  const hasSelection = session !== null && session.selection !== null;
  const invert = (): void => {
    if (session?.selection != null) select(invertMask(session.selection));
  };
  return (
    <span style={groupStyle}>
      <ActionButton
        label="Delete"
        title="Clear the selected area to white (Delete)"
        onClick={deleteSelection}
        enabled={hasSelection}
      />
      <ActionButton
        label="Fill"
        title="Fill the selected area with the foreground colour"
        onClick={fillSelection}
        enabled={hasSelection}
      />
      <ActionButton
        label="Invert"
        title="Invert the selection (Ctrl+Shift+I)"
        onClick={invert}
        enabled={hasSelection}
      />
      <ActionButton
        label="Deselect"
        title="Clear the selection (Ctrl+D)"
        onClick={() => select(null)}
        enabled={hasSelection}
      />
    </span>
  );
}

function ActionButton(props: {
  readonly label: string;
  readonly title: string;
  readonly onClick: () => void;
  readonly enabled: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn"
      onClick={props.onClick}
      disabled={!props.enabled}
      title={props.title}
      style={smallButtonStyle}
    >
      {props.label}
    </button>
  );
}

const groupStyle: React.CSSProperties = { display: 'inline-flex', gap: 6, alignItems: 'center' };
const smallButtonStyle: React.CSSProperties = { padding: '2px 10px' };
const modeButtonStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'grid',
  placeItems: 'center',
  fontSize: 14,
  border: '1px solid transparent',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
};
const activeModeStyle: React.CSSProperties = {
  border: '1px solid var(--lf-accent)',
  background: 'var(--lf-bg-input)',
};
const radiusLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  alignItems: 'center',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const radiusInputStyle: React.CSSProperties = {
  width: 52,
  padding: '2px 4px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
};
