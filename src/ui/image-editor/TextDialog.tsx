// The Image Studio text dialog (ADR-246, V2 plan C): type text, pick one of
// the bundled outline fonts, choose size and ink; OK rasterizes it into a
// new transparent layer you then position with Move / Ctrl+T. Modal card;
// Ctrl+Enter commits (Enter stays a newline in the textarea), Esc cancels.

import { FONT_REGISTRY } from '../../core/text';
import { useTextDialogStore, type TextDialogState } from './text-dialog-store';

const OUTLINE_FONTS = FONT_REGISTRY.filter((entry) => entry.geometry === 'outline');

export function TextDialog(): JSX.Element | null {
  const isOpen = useTextDialogStore((s) => s.isOpen);
  const state = useTextDialogStore();
  if (!isOpen) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add text"
      style={backdropStyle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') state.close();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void state.commit();
        e.stopPropagation();
      }}
    >
      <div style={cardStyle}>
        <strong style={{ fontSize: 13 }}>Add text</strong>
        <textarea
          value={state.text}
          onChange={(e) => state.setText(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Type text — Ctrl+Enter to add"
          style={textareaStyle}
          aria-label="Text content"
          title="The text to rasterize onto a new layer"
        />
        <TextControls state={state} />
        <div style={actionsStyle}>
          <button
            type="button"
            className="lf-btn"
            onClick={state.close}
            title="Close without adding text (Esc)"
          >
            Cancel
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            onClick={() => void state.commit()}
            disabled={state.text.trim().length === 0}
            title="Rasterize onto a new layer (Ctrl+Enter)"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function TextControls(props: { readonly state: TextDialogState }): JSX.Element {
  const { state } = props;
  return (
    <div style={rowStyle}>
      <label style={fieldStyle}>
        Font
        <select
          value={state.fontKey}
          onChange={(e) => state.setFontKey(e.target.value as TextDialogState['fontKey'])}
          style={inputStyle}
          aria-label="Font"
          title="Bundled outline font"
        >
          {OUTLINE_FONTS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.displayName}
            </option>
          ))}
        </select>
      </label>
      <label style={fieldStyle}>
        Size (px)
        <input
          type="number"
          step="any"
          value={state.sizePx}
          onChange={(e) => state.setSizePx(Number(e.target.value))}
          style={inputStyle}
          aria-label="Text size in pixels"
          title="Glyph height in document pixels"
        />
      </label>
      <label style={fieldStyle}>
        Ink
        <select
          value={state.ink}
          onChange={(e) => state.setInk(e.target.value === 'white' ? 'white' : 'black')}
          style={inputStyle}
          aria-label="Ink color"
          title="Black burns; white is empty (no burn)"
        >
          <option value="black">Black</option>
          <option value="white">White</option>
        </select>
      </label>
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1020,
  display: 'grid',
  placeItems: 'center',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: 320,
  padding: 14,
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
  padding: '6px 8px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
  fontSize: 13,
};

const rowStyle: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-end' };

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  flex: 1,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '3px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};
