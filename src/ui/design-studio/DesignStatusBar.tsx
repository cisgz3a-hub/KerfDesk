// DesignStatusBar — the Studio's bottom readout (ADR-271, DS-2).
//
// Carries the three things a precision canvas must always show: where the
// pointer is, what the armed tool expects you to do next, and how big the
// drawing is. LightBurn keeps the live X/Y and segment length on its status bar
// while drawing, and putting the tool's own hint here means discoverability
// lives on the tool instead of in a help page.
//
// Everything here informs. Nothing here refuses (rule 7).

import { formatDisplayMillimetres } from '../format-display-millimetres';
import { snapKindLabel } from './design-snap';
import { DESIGN_TOOL_BY_KIND } from './design-tool';
import { useDesignStudioStore } from './design-studio-store';

export function DesignStatusBar(): JSX.Element | null {
  const session = useDesignStudioStore((state) => state.session);
  if (session === null) return null;
  const tool = DESIGN_TOOL_BY_KIND[session.tool];
  const entityCount = session.history.present.entities.length;
  const trimmed = session.history.trimmedCount;
  return (
    <footer style={barStyle} aria-label="Design Studio status">
      <span style={readoutStyle} aria-live="off">
        {session.cursorMm === null
          ? 'X —  Y —'
          : `X ${formatDisplayMillimetres(session.cursorMm.x)}  Y ${formatDisplayMillimetres(session.cursorMm.y)}`}
      </span>
      <Chip
        on={session.snapEnabled}
        label={
          session.activeSnap === null ? 'Snap' : `Snap: ${snapKindLabel(session.activeSnap.kind)}`
        }
      />
      <Chip on={session.orthoEnabled} label="Ortho" />
      <Chip on={session.showGrid} label={`Grid ${session.gridMm} mm`} />
      <span style={countStyle}>{entityCount === 1 ? '1 entity' : `${entityCount} entities`}</span>
      <span style={hintStyle}>
        {tool.planned === true ? `${tool.label} — not built yet. ` : ''}
        {tool.hint}
      </span>
      {trimmed > 0 ? (
        <span style={countStyle} title="Older undo steps were dropped to bound memory.">
          {trimmed} older step{trimmed === 1 ? '' : 's'} trimmed
        </span>
      ) : null}
    </footer>
  );
}

function Chip(props: { readonly on: boolean; readonly label: string }): JSX.Element {
  return <span style={{ ...chipStyle, ...(props.on ? chipOnStyle : null) }}>{props.label}</span>;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--lf-space-3)',
  padding: '4px 10px',
  borderTop: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  minHeight: 26,
};

// Tabular figures so the coordinate readout does not jitter as digits change —
// the single cheapest thing that makes a precision canvas feel steady.
const readoutStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--lf-text)',
  minWidth: 150,
};

const chipStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid var(--lf-border)',
  opacity: 0.5,
};

const chipOnStyle: React.CSSProperties = {
  opacity: 1,
  color: 'var(--lf-text)',
  borderColor: 'var(--lf-accent)',
};

const countStyle: React.CSSProperties = { whiteSpace: 'nowrap' };

const hintStyle: React.CSSProperties = {
  marginLeft: 'auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
