// The boundary-mode selector shown under the Trace preview once a region box
// exists. 'Crop' (default, LightBurn parity) keeps only the boxed region;
// 'Enhance' re-traces the box supersampled and patches it into the full trace
// to recover small features the full pass dropped (ADR-113). Rendered only when
// a boundary is set — mirrors the Fill-style picker's Field + select + hint
// shape from dialog-parts.tsx.

import type { TraceOptions } from '../../core/trace';
import type { BoundaryMode } from './region-enhance-trace';

const BOUNDARY_MODE_HINT =
  'Crop keeps only the boxed region (like LightBurn). Enhance re-traces the box at 2× and patches it into the full trace to recover small features.';

/** Why a style traces only the boxed region, or null when it offers Enhance.
 *  Enhance replaces whole contours; ribbons spanning a photo and colour
 *  regions sharing boundaries need Crop. */
export function cropOnlyNote(options: TraceOptions | undefined): string | null {
  if (options?.photoDetail !== undefined) {
    return 'Photo shading traces only the boxed region. Use Detail to refine its shading.';
  }
  return options?.colourLayers === undefined ? null : 'Colour layers trace only the boxed region.';
}

export function BoundaryModePicker(props: {
  /** Set when the selected style can only crop (cropOnlyNote). */
  readonly cropOnlyNote?: string | null;
  readonly disabled?: boolean;
  readonly value: BoundaryMode;
  readonly onChange: (next: BoundaryMode) => void;
}): JSX.Element {
  const note = props.cropOnlyNote ?? BOUNDARY_MODE_HINT;
  const allowEnhance = props.cropOnlyNote == null;
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--sm">Boundary</span>
      <span style={fieldControlStyle}>
        <select
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(parseBoundaryMode(e.target.value))}
          className="lf-select"
          style={selectStyle}
          aria-label="Trace boundary mode"
          title={note}
        >
          <option value="crop">Crop region</option>
          {allowEnhance ? <option value="enhance">Enhance region</option> : null}
        </select>
        <span style={hintStyle}>{note}</span>
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
