// InspectorSidebar — the DRO / legend / stats column beside the 3D view
// (ADR-255 stage 4). Presentational: every number comes from the pure
// readout helpers, and the traversal toggle uses LightBurn's exact wording.

import type { ProgramTimeModel } from '../../core/gcode-time';
import type { GcodeRenderModel, ProgramFinding } from '../../core/gcode-view';
import type { Viewer3dTheme } from '../viewer3d';
import { InspectorHealthPanel } from './InspectorHealthPanel';
import { droRows, statsRows, type Readout } from './inspector-readouts';
import {
  LENS_IDS,
  LENS_LABEL,
  lensLegend,
  rampCss,
  type LegendSwatch,
  type LensId,
} from './lenses';
import type { PlayheadState } from './playhead';

export function InspectorSidebar(props: {
  readonly model: GcodeRenderModel;
  readonly theme: Viewer3dTheme;
  readonly playhead: PlayheadState;
  readonly time: ProgramTimeModel;
  readonly findings: ReadonlyArray<ProgramFinding>;
  readonly lens: LensId;
  readonly onLensChange: (lens: LensId) => void;
  readonly arrowsVisible: boolean;
  readonly onArrowsVisibleChange: (visible: boolean) => void;
  readonly travelVisible: boolean;
  readonly onTravelVisibleChange: (visible: boolean) => void;
  readonly onLocateLine: (line: number) => void;
}): JSX.Element {
  return (
    <aside style={sidebarStyle} aria-label="Program readouts">
      <Section title="Position">
        <ReadoutGrid rows={droRows(props.model, props.playhead)} />
      </Section>
      <Section title="Colour by">
        <select
          value={props.lens}
          onChange={(event) => props.onLensChange(event.currentTarget.value as LensId)}
          title="Choose what the toolpath colours mean"
          aria-label="Colour lens"
          style={lensSelectStyle}
        >
          {LENS_IDS.map((id) => (
            <option key={id} value={id}>
              {LENS_LABEL[id]}
            </option>
          ))}
        </select>
        <Legend legend={lensLegend(props.model, props.time, props.lens, props.theme)} />
        <label style={toggleStyle}>
          <input
            type="checkbox"
            title="Show or hide the non-cutting moves between shapes"
            checked={props.travelVisible}
            onChange={(event) => props.onTravelVisibleChange(event.currentTarget.checked)}
          />
          Show traversal moves
        </label>
        <label style={toggleStyle}>
          <input
            type="checkbox"
            title="Mark the cut path with arrows showing direction of travel"
            checked={props.arrowsVisible}
            onChange={(event) => props.onArrowsVisibleChange(event.currentTarget.checked)}
          />
          Show direction arrows
        </label>
      </Section>
      <Section title="Program">
        <ReadoutGrid rows={statsRows(props.model, props.time)} />
      </Section>
      <InspectorHealthPanel findings={props.findings} onLocate={props.onLocateLine} />
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

function Legend(props: { readonly legend: ReturnType<typeof lensLegend> }): JSX.Element {
  if (props.legend.kind === 'note') {
    return <p style={legendNoteStyle}>{props.legend.note}</p>;
  }
  if (props.legend.kind === 'ramp') {
    const ramp = rampCss();
    return (
      <div style={rampWrapStyle}>
        <div
          style={{
            ...rampBarStyle,
            backgroundImage: `linear-gradient(to right, ${ramp.from}, ${ramp.to})`,
          }}
          aria-hidden="true"
        />
        <div style={rampScaleStyle}>
          <span>{props.legend.from}</span>
          <span>{props.legend.to}</span>
        </div>
      </div>
    );
  }
  return <SwatchList entries={props.legend.entries} />;
}

function SwatchList(props: { readonly entries: ReadonlyArray<LegendSwatch> }): JSX.Element {
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

const lensSelectStyle: React.CSSProperties = { width: '100%', marginBottom: 6 };

const legendNoteStyle: React.CSSProperties = {
  margin: '0 0 8px',
  color: 'var(--lf-text-muted)',
};

const rampWrapStyle: React.CSSProperties = { marginBottom: 8 };

const rampBarStyle: React.CSSProperties = {
  height: 8,
  borderRadius: 2,
  border: '1px solid var(--lf-border)',
};

const rampScaleStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  color: 'var(--lf-text-muted)',
  fontVariantNumeric: 'tabular-nums',
  marginTop: 2,
};

const toggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
