// The Image Size / Canvas Size dialog (ADR-242, PP-E): modal card with
// pixel dimensions, aspect lock (Image Size), and the 3×3 anchor grid
// (Canvas Size). Physical mm size never changes on Image Size — only pixel
// density — and the note says so.

import type { CanvasAnchor } from './editor-session-resize';
import { useImageEditorStore } from './image-editor-store';
import { useResizeDialogStore, type ResizeDialog } from './resize-dialog-store';

const ANCHOR_VALUES = [0, 0.5, 1] as const;

export function ResizeDialogPanel(): JSX.Element | null {
  const dialog = useResizeDialogStore((s) => s.dialog);
  const hasSession = useImageEditorStore((s) => s.session !== null);
  if (dialog === null || !hasSession) return null;
  return <ResizeBody dialog={dialog} />;
}

function ResizeBody(props: { readonly dialog: ResizeDialog }): JSX.Element {
  const { dialog } = props;
  const store = useResizeDialogStore.getState();
  const title = dialog.kind === 'image-size' ? 'Image Size' : 'Canvas Size';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={backdropStyle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') store.cancel();
        if (e.key === 'Enter') store.commit();
        e.stopPropagation();
      }}
    >
      <div style={cardStyle}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <DimensionField label="Width (px)" value={dialog.width} onChange={store.setWidth} />
        <DimensionField label="Height (px)" value={dialog.height} onChange={store.setHeight} />
        {dialog.kind === 'image-size' ? (
          <label style={rowStyle} title="Keep the width/height ratio while editing">
            <input
              type="checkbox"
              checked={dialog.lockAspect}
              onChange={(e) => store.setLockAspect(e.target.checked)}
              aria-label="Constrain proportions"
              title="Keep the width/height ratio while editing"
            />
            Constrain proportions
          </label>
        ) : (
          <AnchorGrid anchor={dialog.anchor} onPick={store.setAnchor} />
        )}
        <p style={noteStyle}>
          {dialog.kind === 'image-size'
            ? 'Physical size on the workspace stays the same — only pixel density changes.'
            : 'Growing pads with white; shrinking crops. The anchor holds the existing pixels.'}
        </p>
        <div style={actionsStyle}>
          <button
            type="button"
            className="lf-btn"
            onClick={store.cancel}
            title="Close without resizing (Esc)"
          >
            Cancel
          </button>
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            onClick={store.commit}
            title="Resize the working image (Enter)"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function DimensionField(props: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{props.label}</span>
      <input
        type="number"
        min={1}
        max={8192}
        value={props.value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) props.onChange(next);
        }}
        style={numberStyle}
        aria-label={props.label}
        title={props.label}
      />
    </label>
  );
}

function AnchorGrid(props: {
  readonly anchor: CanvasAnchor;
  readonly onPick: (anchor: CanvasAnchor) => void;
}): JSX.Element {
  return (
    <div style={anchorGridStyle} role="group" aria-label="Anchor">
      {ANCHOR_VALUES.map((y) =>
        ANCHOR_VALUES.map((x) => {
          const isActive = props.anchor.x === x && props.anchor.y === y;
          return (
            <button
              key={`${x}-${y}`}
              type="button"
              className={isActive ? 'lf-btn lf-btn--primary' : 'lf-btn'}
              style={anchorCellStyle}
              onClick={() => props.onPick({ x, y })}
              aria-pressed={isActive}
              title={`Anchor the existing pixels at ${anchorName(x, y)}`}
            >
              {isActive ? '●' : '·'}
            </button>
          );
        }),
      )}
    </div>
  );
}

function anchorName(x: number, y: number): string {
  const col = x === 0 ? 'left' : x === 1 ? 'right' : 'centre';
  const row = y === 0 ? 'top' : y === 1 ? 'bottom' : 'middle';
  return row === 'middle' && col === 'centre' ? 'the centre' : `${row} ${col}`;
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
  width: 280,
  padding: 14,
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--lf-text)',
};

const labelStyle: React.CSSProperties = {
  width: 88,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

const numberStyle: React.CSSProperties = {
  flex: 1,
  boxSizing: 'border-box',
  padding: '3px 6px',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-input)',
  color: 'var(--lf-text)',
  borderRadius: 4,
  fontSize: 12,
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};

const anchorGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 32px)',
  gap: 4,
  justifyContent: 'center',
};

const anchorCellStyle: React.CSSProperties = {
  width: 32,
  height: 28,
  padding: 0,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};
