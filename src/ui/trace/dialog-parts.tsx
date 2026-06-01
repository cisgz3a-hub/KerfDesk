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

export function PresetPicker(props: {
  readonly value: string;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  return (
    <Field label="Preset">
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={selectStyle}
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

export function DialogActions(props: {
  readonly canSubmit: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div style={actionsStyle}>
      <button type="button" onClick={props.onCancel} disabled={props.busy}>
        Cancel
      </button>
      <button type="submit" disabled={!props.canSubmit}>
        {props.busy ? 'Tracing…' : 'Trace'}
      </button>
    </div>
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
      pixel-perfect detail, no blur. <strong>Detailed</strong> — line drawings with shading (~4
      layers). <strong>Photo</strong> — actual photographs (~8 posterized layers).
    </p>
  );
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{props.label}</span>
      <span style={fieldControlStyle}>{props.children}</span>
    </label>
  );
}

export const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
export const panelStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 6,
  padding: 16,
  minWidth: 380,
  maxWidth: 520,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontFamily: 'system-ui, sans-serif',
};
export const headingStyle: React.CSSProperties = { margin: 0, fontSize: 16 };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const fieldLabelStyle: React.CSSProperties = { width: 90, color: '#444' };
const fieldControlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const fileNameStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#555',
  maxWidth: 240,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const selectStyle: React.CSSProperties = { flex: 1, fontSize: 13 };
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  margin: '4px 0 0 0',
  fontStyle: 'italic',
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
};
