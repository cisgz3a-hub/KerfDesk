// InspectorSidebar — the DRO / legend / stats column beside the 3D view
// (ADR-255 stage 4). Presentational: every number comes from the pure
// readout helpers, and the traversal toggle uses LightBurn's exact wording.

import type { GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dTheme } from '../viewer3d';
import {
  droRows,
  findingsSummary,
  legendEntries,
  statsRows,
  type LegendEntry,
  type Readout,
} from './inspector-readouts';
import type { PlayheadState } from './playhead';

export function InspectorSidebar(props: {
  readonly model: GcodeRenderModel;
  readonly theme: Viewer3dTheme;
  readonly playhead: PlayheadState;
  readonly travelVisible: boolean;
  readonly onTravelVisibleChange: (visible: boolean) => void;
}): JSX.Element {
  const findings = findingsSummary(props.model);
  return (
    <aside style={sidebarStyle} aria-label="Program readouts">
      <Section title="Position">
        <ReadoutGrid rows={droRows(props.model, props.playhead)} />
      </Section>
      <Section title="Moves">
        <Legend entries={legendEntries(props.model, props.theme)} />
        <label style={toggleStyle}>
          <input
            type="checkbox"
            title="Show or hide the non-cutting moves between shapes"
            checked={props.travelVisible}
            onChange={(event) => props.onTravelVisibleChange(event.currentTarget.checked)}
          />
          Show traversal moves
        </label>
      </Section>
      <Section title="Program">
        <ReadoutGrid rows={statsRows(props.model)} />
      </Section>
      {findings === null ? null : (
        <Section title="Findings">
          <p style={findingsStyle}>{findings}</p>
          <p style={noteStyle}>Findings inform. Nothing here blocks Frame, Start, or export.</p>
        </Section>
      )}
    </aside>
  );
}

function Section(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function ReadoutGrid(props: { readonly rows: ReadonlyArray<Readout> }): JSX.Element {
  return (
    <dl style={gridStyle}>
      {props.rows.map((row) => (
        <div key={row.label} style={rowStyle}>
          <dt style={labelStyle}>{row.label}</dt>
          <dd style={valueStyle}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Legend(props: { readonly entries: ReadonlyArray<LegendEntry> }): JSX.Element {
  return (
    <ul style={legendStyle}>
      {props.entries.map((entry) => (
        <li key={entry.label} style={legendItemStyle}>
          <span style={{ ...swatchStyle, background: entry.color }} aria-hidden="true" />
          <span>{entry.label}</span>
          <span style={legendCountStyle}>{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}

const sidebarStyle: React.CSSProperties = {
  width: 250,
  flexShrink: 0,
  overflowY: 'auto',
  padding: '4px 12px 12px',
  borderLeft: '1px solid var(--lf-border)',
  fontSize: 'var(--lf-text-sm)',
};

const sectionStyle: React.CSSProperties = { marginTop: 12 };

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 'var(--lf-text-xs)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--lf-text-muted)',
};

const gridStyle: React.CSSProperties = { margin: 0, display: 'grid', gap: 2 };

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
};

const labelStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)' };

const valueStyle: React.CSSProperties = {
  margin: 0,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};

const legendStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '0 0 8px',
  padding: 0,
  display: 'grid',
  gap: 3,
};

const legendItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const swatchStyle: React.CSSProperties = {
  width: 12,
  height: 3,
  borderRadius: 2,
  display: 'inline-block',
};

const legendCountStyle: React.CSSProperties = {
  marginLeft: 'auto',
  color: 'var(--lf-text-muted)',
  fontVariantNumeric: 'tabular-nums',
};

const toggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const findingsStyle: React.CSSProperties = { margin: '0 0 6px' };

const noteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
};
