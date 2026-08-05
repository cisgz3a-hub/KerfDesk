// Shared colour-lens selector and legend for both G-code 3D surfaces.

import { useMemo } from 'react';
import type { ProgramTimeModel } from '../../core/gcode-time';
import type { GcodeRenderModel } from '../../core/gcode-view';
import type { Viewer3dTheme } from '../viewer3d';
import {
  LENS_IDS,
  LENS_LABEL,
  lensLegend,
  type LegendSwatch,
  type LensId,
  type LensLegend,
} from './lenses';

type InspectorLensControlProps = {
  readonly model: GcodeRenderModel;
  readonly time: ProgramTimeModel;
  readonly theme: Viewer3dTheme;
  readonly lens: LensId;
  readonly onLensChange: (lens: LensId) => void;
  /** Sidebar fills the readout column; overlay adds compact positioned chrome. */
  readonly variant: 'sidebar' | 'overlay';
};

/** Shared colour selector and accessible legend for both G-code 3D surfaces. */
export function InspectorLensControl(props: InspectorLensControlProps): JSX.Element {
  const legend = useMemo(
    () => lensLegend(props.model, props.time, props.lens, props.theme),
    [props.model, props.time, props.lens, props.theme],
  );
  return (
    <div style={props.variant === 'overlay' ? overlayStyle : undefined}>
      {props.variant === 'overlay' ? <strong style={titleStyle}>Colour by</strong> : null}
      <select
        value={props.lens}
        onChange={(event) => {
          const nextLens = LENS_IDS.find((id) => id === event.currentTarget.value);
          if (nextLens !== undefined) props.onLensChange(nextLens);
        }}
        title="Choose what the toolpath colours mean"
        aria-label="Colour lens"
        style={selectStyle}
      >
        {LENS_IDS.map((id) => (
          <option key={id} value={id}>
            {LENS_LABEL[id]}
          </option>
        ))}
      </select>
      <Legend legend={legend} />
    </div>
  );
}

function Legend(props: { readonly legend: LensLegend }): JSX.Element {
  if (props.legend.kind === 'note') return <p style={noteStyle}>{props.legend.note}</p>;
  if (props.legend.kind === 'swatches') return <SwatchList entries={props.legend.entries} />;
  return (
    <div style={rampWrapStyle}>
      <p style={noteStyle}>{props.legend.note}</p>
      <div
        style={{
          ...rampBarStyle,
          backgroundImage: `linear-gradient(to right, ${props.legend.fromColor}, ${props.legend.toColor})`,
        }}
        role="img"
        aria-label={`${props.legend.note}: ${props.legend.from} to ${props.legend.to}`}
      />
      <div style={rampScaleStyle}>
        <span>{props.legend.from}</span>
        <span>{props.legend.to}</span>
      </div>
    </div>
  );
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

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  left: 10,
  bottom: 10,
  zIndex: 2,
  width: 230,
  maxWidth: 'calc(100% - 20px)',
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 'var(--lf-radius-lg)',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  fontSize: 'var(--lf-text-xs)',
};

const titleStyle: React.CSSProperties = { display: 'block', marginBottom: 4 };
const selectStyle: React.CSSProperties = { width: '100%', marginBottom: 6 };
const noteStyle: React.CSSProperties = { margin: '0 0 4px', color: 'var(--lf-text-muted)' };
const rampWrapStyle: React.CSSProperties = { marginBottom: 2 };
const rampBarStyle: React.CSSProperties = {
  height: 8,
  borderRadius: 2,
  border: '1px solid var(--lf-border)',
};
const rampScaleStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  color: 'var(--lf-text-muted)',
  fontVariantNumeric: 'tabular-nums',
  marginTop: 2,
};
const legendStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '0 0 8px',
  padding: 0,
  display: 'grid',
  gap: 3,
};
const legendItemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
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
