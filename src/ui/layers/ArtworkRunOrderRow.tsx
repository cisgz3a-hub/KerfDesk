import type { ArtworkRunOrderRowModel } from './artwork-run-order-view-model';

export function ArtworkRunOrderRow(props: {
  readonly row: ArtworkRunOrderRowModel;
  readonly active: boolean;
  readonly machineKind: 'laser' | 'cnc';
  readonly onFocus: () => void;
  readonly onMove: (position: number) => void;
  readonly onEditSettings: () => void;
}): JSX.Element {
  const accent = props.row.colors[0] ?? 'var(--lf-accent)';
  return (
    <article
      aria-label={`Run ${props.row.position}: ${props.row.name}`}
      aria-current={props.active ? 'true' : undefined}
      style={{
        ...rowStyle,
        borderLeftColor: props.active ? accent : 'transparent',
        background: props.active ? 'var(--lf-accent-wash)' : 'var(--lf-bg-1)',
      }}
      onClick={props.onFocus}
    >
      <div style={headingStyle}>
        <label style={positionLabelStyle} onClick={stopPropagation}>
          <span>Run</span>
          <input
            key={`${props.row.key}:${props.row.position}`}
            type="number"
            min={1}
            step={1}
            defaultValue={props.row.position}
            aria-label={`Run position for ${props.row.name}`}
            title="Enter the exact run number"
            style={positionInputStyle}
            onBlur={(event) => props.onMove(Number(event.currentTarget.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
        <div style={identityStyle}>
          <strong title={props.row.name} style={nameStyle}>
            {props.row.name}
          </strong>
          <span style={mutedStyle}>
            {props.row.kindLabel} · {props.row.dimensions}
          </span>
        </div>
        <div aria-label="Operation colors" style={swatchesStyle}>
          {props.row.colors.slice(0, 4).map((color) => (
            <span key={color} title={color} style={{ ...swatchStyle, background: color }} />
          ))}
        </div>
      </div>
      <div style={detailsStyle}>
        <span title={props.row.operationSummary}>{props.row.operationSummary}</span>
        <span title={props.row.settingsSummary} style={mutedStyle}>
          {props.row.settingsSummary}
        </span>
        <span style={effectiveStyle}>
          {effectiveOrderText(props.row.effectiveSteps, props.machineKind, props.row.output)}
        </span>
      </div>
      <div style={footerStyle}>
        <span style={statusStyle}>
          {props.row.shared ? 'One shared run unit' : props.row.output ? 'Output on' : 'Output off'}
        </span>
        <button
          type="button"
          title={`Edit settings for ${props.row.name}`}
          className="lf-btn lf-btn--ghost"
          onClick={(event) => {
            event.stopPropagation();
            props.onEditSettings();
          }}
        >
          Edit settings
        </button>
      </div>
    </article>
  );
}

function effectiveOrderText(
  steps: ReadonlyArray<number>,
  machineKind: 'laser' | 'cnc',
  output: boolean,
): string {
  if (!output || steps.length === 0) return 'Not present in machine output';
  const label = steps.length === 1 ? `${steps[0]}` : steps.join(', ');
  return machineKind === 'cnc'
    ? `Effective CNC step${steps.length === 1 ? '' : 's'}: ${label}`
    : `Laser output step${steps.length === 1 ? '' : 's'}: ${label}`;
}

function stopPropagation(event: React.MouseEvent): void {
  event.stopPropagation();
}

const rowStyle: React.CSSProperties = {
  height: 144,
  boxSizing: 'border-box',
  border: '1px solid var(--lf-border)',
  borderLeft: '4px solid transparent',
  borderRadius: 6,
  padding: 9,
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  cursor: 'pointer',
  overflow: 'hidden',
};
const headingStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const positionLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 700,
};
const positionInputStyle: React.CSSProperties = { width: 54, minHeight: 30, fontWeight: 700 };
const identityStyle: React.CSSProperties = {
  minWidth: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
};
const nameStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const mutedStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const swatchesStyle: React.CSSProperties = { display: 'flex', alignItems: 'center' };
const swatchStyle: React.CSSProperties = {
  width: 14,
  height: 24,
  border: '1px solid var(--lf-border-strong)',
  marginLeft: -3,
};
const detailsStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 11,
};
const effectiveStyle: React.CSSProperties = { color: 'var(--lf-accent)', fontWeight: 650 };
const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  marginTop: 'auto',
};
const statusStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-muted)' };
