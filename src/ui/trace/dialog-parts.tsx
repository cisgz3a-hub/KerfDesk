// Presentational pieces of ImportImageDialog — the source label, preset
// dropdown, action row, label/field shell, and every shared style
// constant. Split out so the dialog file holds only orchestration
// (state, the commit flow, render) and stays under the 250-line soft
// cap.
//
// No state, no effects — every component is a pure function of its
// props. Style consts live here because they're shared across the
// parts and would otherwise duplicate.

import { TRACE_PRESETS } from '../../core/trace';
import { Button, DialogActions as KitDialogActions } from '../kit';

export function PresetPicker(props: {
  readonly value: string;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  return (
    <Field label="Preset">
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="lf-select"
        style={selectStyle}
        aria-label="Trace preset"
        title="Choose a trace preset tuned for line art, smooth logos, centerlines, or sharp detail."
      >
        {Object.keys(TRACE_PRESETS).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </Field>
  );
}

// Trace runs on an already-imported bitmap (LightBurn's model, ADR-027),
// so the dialog shows which image it's tracing rather than offering a
// file pick. Long filenames truncate with an ellipsis.
export function SourceLabel(props: { readonly name: string }): JSX.Element {
  return (
    <Field label="Image">
      <span style={fileNameStyle} title={props.name}>
        {props.name}
      </span>
    </Field>
  );
}

export function DeleteImageAfterTraceToggle(props: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={checkboxRowStyle}>
      <input
        type="checkbox"
        className="lf-checkbox"
        checked={props.checked}
        title="Remove the source bitmap from the workspace after creating traced vectors."
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>Delete Image After trace</span>
    </label>
  );
}

export function DialogActions(props: {
  readonly canSubmit: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <KitDialogActions>
      <Button onClick={props.onCancel} disabled={props.busy}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={!props.canSubmit}>
        {props.busy ? 'Tracing…' : 'Trace'}
      </Button>
    </KitDialogActions>
  );
}

// The preset hint paragraph below the controls — kept here so the
// copy and the styling sit together; the dialog only renders <PresetHint />
// with no props.
export function PresetHint(): JSX.Element {
  return (
    <p style={hintStyle}>
      <strong>Line Art</strong> (default) — black-on-white logos / SVG-style line drawings. Forces
      pure 2-color output. <strong>Smooth</strong> — slightly noisy line art with curves.{' '}
      <strong>Centerline</strong> — one vector path down black strokes. <strong>Sharp</strong> —
      pixel-perfect detail, no blur. For photos and shaded/continuous-tone images, do not trace —
      engrave them directly as a raster image (Image layer), which is how LightBurn handles
      photographs.
    </p>
  );
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--sm">{props.label}</span>
      <span style={fieldControlStyle}>{props.children}</span>
    </label>
  );
}

const fieldControlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const fileNameStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  maxWidth: 240,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const selectStyle: React.CSSProperties = { flex: 1, fontSize: 13 };
const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '4px 0 0 0',
  fontStyle: 'italic',
};
