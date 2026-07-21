// The Image Studio History panel (ADR-242, PP-F): Photoshop's time-travel
// list — every recorded step from "Open" to the newest op, with undone
// (future) steps greyed below the current state. Clicking any row jumps
// there; budget-evicted steps surface as a trimmed note, never a block.

import { jumpEditorHistory, type HistoryTarget } from './editor-time-travel';
import { useImageEditorStore } from './image-editor-store';

type HistoryRow = {
  readonly key: string;
  readonly label: string;
  readonly target: HistoryTarget;
  readonly isCurrent: boolean;
  readonly isFuture: boolean;
};

export function HistoryPanel(): JSX.Element | null {
  const session = useImageEditorStore((s) => s.session);
  if (session === null) return null;
  const { undoStack, redoStack, trimmedCount } = session.history;

  const rows: HistoryRow[] = [
    {
      key: 'open',
      label: trimmedCount > 0 ? `Open (+${trimmedCount} trimmed)` : 'Open',
      target: { kind: 'open' },
      isCurrent: undoStack.length === 0,
      isFuture: false,
    },
    ...undoStack.map((entry, index) => ({
      key: `past-${index}`,
      label: entry.label,
      target: { kind: 'past', index } as const,
      isCurrent: index === undoStack.length - 1,
      isFuture: false,
    })),
    // Nearest future first — reading downward continues the timeline.
    ...[...redoStack].reverse().map((entry, index) => ({
      key: `future-${index}`,
      label: entry.label,
      target: { kind: 'future', index } as const,
      isCurrent: false,
      isFuture: true,
    })),
  ];

  return (
    <aside style={panelStyle} aria-label="History panel">
      <strong style={headerStyle}>History</strong>
      <div style={listStyle}>
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            className="lf-btn lf-btn--ghost"
            style={{
              ...rowStyle,
              ...(row.isCurrent ? currentRowStyle : null),
              ...(row.isFuture ? futureRowStyle : null),
            }}
            onClick={() => jumpEditorHistory(row.target)}
            aria-current={row.isCurrent ? 'step' : undefined}
            title={
              row.isCurrent
                ? 'Current state'
                : row.isFuture
                  ? `Redo forward to after "${row.label}"`
                  : `Jump back to after "${row.label}"`
            }
          >
            {row.label}
          </button>
        ))}
      </div>
    </aside>
  );
}

const PANEL_WIDTH = 168;

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: PANEL_WIDTH,
  minWidth: PANEL_WIDTH,
  borderLeft: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  color: 'var(--lf-text)',
  borderBottom: '1px solid var(--lf-border)',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  padding: 4,
  gap: 2,
};

const rowStyle: React.CSSProperties = {
  justifyContent: 'flex-start',
  textAlign: 'left',
  width: '100%',
  fontSize: 12,
  padding: '3px 8px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const currentRowStyle: React.CSSProperties = {
  background: 'var(--lf-bg-2)',
  fontWeight: 600,
};

const futureRowStyle: React.CSSProperties = {
  opacity: 0.55,
};
