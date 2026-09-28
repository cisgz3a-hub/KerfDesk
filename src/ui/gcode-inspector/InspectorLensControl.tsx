// Shared colour-lens selector and legend for both G-code 3D surfaces.

import { useMemo } from 'react';
import type { Viewer3dTheme } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dLook } from '../viewer3d/viewer3d-look';
import type { InspectorProgramTime, InspectorRenderModel } from './inspector-model';
import {
  LENS_IDS,
  LENS_LABEL,
  lensLegend,
  type LegendSwatch,
  type LensId,
  type LensLegend,
} from './lenses';
import type { ToolSections } from './tool-sections';

type InspectorLensControlProps = {
  readonly model: InspectorRenderModel;
  readonly time: Pick<InspectorProgramTime, 'segFeedLimited'>;
  readonly theme: Viewer3dTheme;
  readonly look?: Viewer3dLook | undefined;
  readonly sections?: ToolSections | null | undefined;
  readonly lens: LensId;
  readonly onLensChange: (lens: LensId) => void;
  /** Legend entries switched off (ADR-470). */
  readonly hiddenEntries?: ReadonlySet<number>;
  /** Switches a legend entry's moves off or on; null when the legend has none. */
  readonly onToggleEntry?: ((entry: number) => void) | null;
  /** Sidebar fills the readout column; overlay adds compact positioned chrome. */
  readonly variant: 'sidebar' | 'overlay';
};

/** Shared colour selector and accessible legend for both G-code 3D surfaces. */
export function InspectorLensControl(props: InspectorLensControlProps): JSX.Element {
  const { model, time, lens, theme, look, sections } = props;
  const legend = useMemo(
    () => lensLegend(model, time, lens, theme, { look, sections }),
    [model, time, lens, theme, look, sections],
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
      <Legend
        legend={legend}
        hidden={props.hiddenEntries ?? NOTHING_HIDDEN}
        onToggle={props.onToggleEntry ?? null}
      />
    </div>
  );
}

const NOTHING_HIDDEN: ReadonlySet<number> = new Set();

function Legend(props: {
  readonly legend: LensLegend;
  readonly hidden: ReadonlySet<number>;
  readonly onToggle: ((entry: number) => void) | null;
}): JSX.Element {
  if (props.legend.kind === 'note') return <p style={noteStyle}>{props.legend.note}</p>;
  if (props.legend.kind === 'swatches') {
    return (
      <SwatchList entries={props.legend.entries} hidden={props.hidden} onToggle={props.onToggle} />
    );
  }
  return (
    <div style={rampWrapStyle}>
      <p style={noteStyle}>{props.legend.note}</p>
      <div
        style={{
          ...rampBarStyle,
          backgroundImage: `linear-gradient(to right, ${props.legend.stops.join(', ')})`,
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

// Each entry is a switch for its moves when the view can filter them.
function SwatchList(props: {
  readonly entries: ReadonlyArray<LegendSwatch>;
  readonly hidden: ReadonlySet<number>;
  readonly onToggle: ((entry: number) => void) | null;
}): JSX.Element {
  const { onToggle } = props;
  return (
    <ul style={legendStyle}>
      {props.entries.map((entry, index) => {
        const shown = !props.hidden.has(index);
        const content = (
          <>
            <span style={{ ...swatchStyle, background: entry.color }} aria-hidden="true" />
            <span style={shown ? undefined : hiddenLabelStyle}>{entry.label}</span>
            <span style={legendCountStyle}>{entry.count}</span>
          </>
        );
        return (
          <li key={`${index}:${entry.label}`} style={shown ? undefined : hiddenItemStyle}>
            {onToggle === null ? (
              <span style={legendItemStyle}>{content}</span>
            ) : (
              <button
                type="button"
                style={legendButtonStyle}
                aria-pressed={shown}
                title={`${shown ? 'Hide' : 'Show'} ${entry.label.toLowerCase()} moves`}
                onClick={() => onToggle(index)}
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
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
const legendButtonStyle: React.CSSProperties = {
  ...legendItemStyle,
  width: '100%',
  padding: '1px 2px',
  border: 0,
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};
const hiddenItemStyle: React.CSSProperties = { opacity: 0.45 };
const hiddenLabelStyle: React.CSSProperties = { textDecoration: 'line-through' };
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
