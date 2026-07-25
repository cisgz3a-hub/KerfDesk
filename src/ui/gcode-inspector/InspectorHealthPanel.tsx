// InspectorHealthPanel — the Program Health report (ADR-255 stage 6).
//
// Findings inform; they never refuse. The header says so in the UI so an
// operator is never left guessing whether the Inspector is withholding
// something (CLAUDE.md rule 7 / ADR-228).

import type { FindingSeverity, ProgramFinding } from '../../core/gcode-view';

const SEVERITY_LABEL: Readonly<Record<FindingSeverity, string>> = {
  warning: 'Warning',
  notice: 'Notice',
  info: 'Info',
};

const SEVERITY_COLOR: Readonly<Record<FindingSeverity, string>> = {
  warning: 'var(--lf-warning)',
  notice: 'var(--lf-accent)',
  info: 'var(--lf-text-muted)',
};

export function InspectorHealthPanel(props: {
  readonly findings: ReadonlyArray<ProgramFinding>;
  /** Jumps the playhead to a finding's line; absent when it has no line. */
  readonly onLocate: (line: number) => void;
}): JSX.Element {
  return (
    <section style={panelStyle} aria-label="Program health">
      <h3 style={titleStyle}>Program health</h3>
      {props.findings.length === 0 ? (
        <p style={cleanStyle}>No findings — nothing unusual was seen in this program.</p>
      ) : (
        <ul style={listStyle}>
          {props.findings.map((finding) => (
            <FindingRow key={finding.id} finding={finding} onLocate={props.onLocate} />
          ))}
        </ul>
      )}
      <p style={noteStyle}>Findings inform. Nothing here blocks Frame, Start, or export.</p>
    </section>
  );
}

function FindingRow(props: {
  readonly finding: ProgramFinding;
  readonly onLocate: (line: number) => void;
}): JSX.Element {
  const { finding } = props;
  return (
    <li style={rowStyle}>
      <div style={headRowStyle}>
        <span style={{ ...badgeStyle, color: SEVERITY_COLOR[finding.severity] }}>
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <span style={rowTitleStyle}>{finding.title}</span>
        {finding.count > 1 ? <span style={countStyle}>×{finding.count}</span> : null}
      </div>
      <p style={detailStyle}>{finding.detail}</p>
      {finding.line === null ? null : (
        <button
          type="button"
          className="lf-btn"
          style={locateStyle}
          title="Move the playhead to this line"
          onClick={() => props.onLocate(finding.line ?? 0)}
        >
          Go to line {finding.line + 1}
        </button>
      )}
    </li>
  );
}

const panelStyle: React.CSSProperties = { marginTop: 12 };

const titleStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 'var(--lf-text-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--lf-text-muted)',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 8,
};

const rowStyle: React.CSSProperties = {
  borderLeft: '2px solid var(--lf-border)',
  paddingLeft: 8,
};

const headRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 'var(--lf-text-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const rowTitleStyle: React.CSSProperties = { fontWeight: 600 };

const countStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: 'var(--lf-text-muted)',
  fontVariantNumeric: 'tabular-nums',
};

const detailStyle: React.CSSProperties = {
  margin: '2px 0 4px',
  color: 'var(--lf-text-muted)',
};

const locateStyle: React.CSSProperties = {
  padding: '1px 6px',
  fontSize: 'var(--lf-text-xs)',
};

const cleanStyle: React.CSSProperties = { margin: '0 0 6px' };

const noteStyle: React.CSSProperties = {
  margin: '8px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
};
