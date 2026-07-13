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

export const VISIBLE_TRACE_PRESET_NAMES = [
  'Line Art',
  'Smooth',
  'Sharp',
  'Centerline',
  'Edge Detection',
] as const;

export type TraceFillStyle = 'scanline' | 'offset' | 'island';

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
        title="Choose a trace preset tuned for line art, smooth logos, centerlines, sharp detail, or edge-line drawings."
      >
        {VISIBLE_TRACE_PRESET_NAMES.filter((key) => TRACE_PRESETS[key] !== undefined).map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TraceFillStylePicker(props: {
  readonly value: TraceFillStyle;
  readonly onChange: (next: TraceFillStyle) => void;
}): JSX.Element {
  return (
    <Field label="Fill style">
      <select
        value={props.value}
        onChange={(e) => props.onChange(parseTraceFillStyle(e.target.value))}
        className="lf-select"
        style={selectStyle}
        aria-label="Trace fill style"
        title="Choose how filled-contour traces should be engraved."
      >
        <option value="scanline">Scanline</option>
        <option value="offset">Follow Shape</option>
        <option value="island">Island Fill</option>
      </select>
      <span style={fillStyleHintStyle}>
        Follow Shape is best for closed logos, wreaths, and hollow designs. Island Fill burns
        connected regions with short straight scanlines.
      </span>
    </Field>
  );
}

function parseTraceFillStyle(value: string): TraceFillStyle {
  if (value === 'island') return value;
  if (value === 'offset') return value;
  return 'scanline';
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
      pixel-perfect detail, no blur. <strong>Edge Detection</strong> — single lines along the
      brightness edges of full-colour art. For photos and shaded/continuous-tone images, do not
      trace — engrave them directly as a raster image (Image layer), which is how LightBurn handles
      photographs.
    </p>
  );
}

// CNC-only advisory: outline presets trace both sides of a thin stroke, so on a
// profile cut a thin line becomes two cuts bracketing it — point operators at
// the Centerline preset for a single pass. Cutting out filled shapes/logos (the
// common CNC case) is unaffected. Shown only when the project machine is CNC.
export function CncTraceHint(): JSX.Element {
  return (
    <p style={cncHintStyle}>
      Cutting on CNC: the outline presets (Line Art, Smooth, Sharp) trace shape edges — ideal for
      cutting a filled shape or logo out, but a thin line becomes two cuts bracketing it. For a
      single pass down thin strokes, pick the <strong>Centerline</strong> preset.
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
const fillStyleHintStyle: React.CSSProperties = {
  flexBasis: '100%',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
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
const cncHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '0 0 6px 0',
  lineHeight: 1.3,
};
