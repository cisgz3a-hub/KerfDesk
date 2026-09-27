// InspectorSidebar — the DRO / legend / stats column beside the 3D view
// (ADR-255 stage 4). Presentational: every number comes from the pure
// readout helpers, and the traversal toggle uses LightBurn's exact wording.

import { useMemo } from 'react';
import type { ProgramFinding } from '../../core/gcode-view';
import type { Viewer3dTheme } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dLook } from '../viewer3d/viewer3d-look';
import type { InspectorProgramTime, InspectorRenderModel } from './inspector-model';
import { InspectorHealthPanel } from './InspectorHealthPanel';
import { InspectorIsolateControl } from './InspectorIsolateControl';
import { InspectorLensControl } from './InspectorLensControl';
import { droRows, statsRows, type Readout } from './inspector-readouts';
import type { IsolateState } from './isolate';
import type { LensId } from './lenses';
import type { PlayheadState } from './playhead';
import type { ToolSections } from './tool-sections';

type InspectorSidebarProps = {
  readonly model: InspectorRenderModel;
  readonly theme: Viewer3dTheme;
  readonly look?: Viewer3dLook | undefined;
  readonly sections?: ToolSections | null | undefined;
  readonly playhead: PlayheadState;
  readonly time: InspectorProgramTime;
  /** Device profile the time assumes; null for stock GRBL limits. */
  readonly timedFor: string | null;
  readonly findings: ReadonlyArray<ProgramFinding>;
  readonly lens: LensId;
  readonly onLensChange: (lens: LensId) => void;
  readonly arrowsVisible: boolean;
  readonly onArrowsVisibleChange: (visible: boolean) => void;
  readonly travelVisible: boolean;
  readonly onTravelVisibleChange: (visible: boolean) => void;
  readonly onLocateLine: (line: number) => void;
  /** Legend filters and the Z range and section (ADR-470). */
  readonly hiddenEntries: ReadonlySet<number>;
  readonly onToggleEntry: ((entry: number) => void) | null;
  readonly isolate: IsolateState;
  readonly onIsolateChange: (next: IsolateState) => void;
};

export function InspectorSidebar(props: InspectorSidebarProps): JSX.Element {
  // Playback re-renders this column every animation frame. statsRows scans
  // every segment, so derive it per PROGRAM, not per frame. The lens control
  // applies the same memo boundary to its legend; droRows reads one segment.
  const stats = useMemo(
    () => statsRows(props.model, props.time, props.timedFor),
    [props.model, props.time, props.timedFor],
  );
  return (
    <aside style={sidebarStyle} aria-label="Program readouts">
      <Section title="Position">
        <ReadoutGrid rows={droRows(props.model, props.playhead)} />
      </Section>
      <Section title="Colour by">
        <InspectorLensControl
          model={props.model}
          time={props.time}
          theme={props.theme}
          look={props.look}
          sections={props.sections}
          lens={props.lens}
          onLensChange={props.onLensChange}
          hiddenEntries={props.hiddenEntries}
          onToggleEntry={props.onToggleEntry}
          variant="sidebar"
        />
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
      <Section title="Isolate">
        <InspectorIsolateControl
          model={props.model}
          isolate={props.isolate}
          onChange={props.onIsolateChange}
        />
      </Section>
      <Section title="Program">
        <ReadoutGrid rows={stats} />
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

const toggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
