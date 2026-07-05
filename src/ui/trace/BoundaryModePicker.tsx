// The boundary-mode selector shown under the Trace preview once a region box
// exists. 'Crop' (default, LightBurn parity) keeps only the boxed region;
// 'Enhance' re-traces the box supersampled and patches it into the full trace
// to recover small features the full pass dropped (ADR-113). Rendered only when
// a boundary is set — mirrors the Fill-style picker's Field + select + hint
// shape from dialog-parts.tsx.

import type { BoundaryMode } from './region-enhance-trace';

const BOUNDARY_MODE_HINT =
  'Crop keeps only the boxed region (like LightBurn). Enhance re-traces the box at 2× and patches it into the full trace to recover small features.';

export function BoundaryModePicker(props: {
  readonly value: BoundaryMode;
  readonly onChange: (next: BoundaryMode) => void;
}): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--sm">Boundary</span>
      <span style={fieldControlStyle}>
        <select
          value={props.value}
          onChange={(e) => props.onChange(parseBoundaryMode(e.target.value))}
          className="lf-select"
          style={selectStyle}
          aria-label="Trace boundary mode"
          title="Choose whether the boundary box crops the trace or enhances that region."
        >
          <option value="crop">Crop region</option>
          <option value="enhance">Enhance region</option>
        </select>
        <span style={hintStyle}>{BOUNDARY_MODE_HINT}</span>
      </span>
    </label>
  );
}

function parseBoundaryMode(value: string): BoundaryMode {
  return value === 'enhance' ? 'enhance' : 'crop';
}

const fieldControlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const selectStyle: React.CSSProperties = { flex: 1, fontSize: 13 };
const hintStyle: React.CSSProperties = {
  flexBasis: '100%',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
