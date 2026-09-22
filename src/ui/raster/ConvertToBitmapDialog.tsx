import { useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { DEFAULT_BITMAP_BRIGHTNESS_PERCENT } from '../../core/raster';
import {
  DEFAULT_CONVERT_TO_BITMAP_DPI,
  estimateBitmapConversion,
  MAX_CONVERT_TO_BITMAP_DPI,
  MIN_CONVERT_TO_BITMAP_DPI,
  normalizeConvertToBitmapDpi,
  type BitmapConversionTarget,
} from './bitmap-conversion-plan';
import { type ConvertToBitmapRenderType } from './vector-to-bitmap';

const MIN_BRIGHTNESS_PERCENT = 0;
const MAX_BRIGHTNESS_PERCENT = 100;

export type ConvertToBitmapDialogOptions = {
  readonly renderType: ConvertToBitmapRenderType;
  readonly dpi: number;
  readonly brightnessPercent: number;
};

export function ConvertToBitmapDialog(props: {
  readonly sourceName: string;
  readonly target: BitmapConversionTarget;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onCancel: () => void;
  readonly onConvert: (options: ConvertToBitmapDialogOptions) => void;
}): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  // Raw text, NOT a clamped number: clamping every keystroke made typed DPI
  // entry impossible (any first digit is below the minimum and snapped to it).
  // The live estimate and the submit normalize; the field never fights back.
  const [dpiText, setDpiText] = useState(String(DEFAULT_CONVERT_TO_BITMAP_DPI));
  const plan = useMemo(
    () => estimateBitmapConversion(props.target, parseDpi(dpiText)),
    [dpiText, props.target],
  );
  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (props.busy) return;
    const form = e.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    submitConvert(form, plan.verdict.kind, props.onConvert);
  };
  const onConvertClick = (): void => {
    if (props.busy || formRef.current === null) return;
    submitConvert(formRef.current, plan.verdict.kind, props.onConvert);
  };
  // kit Dialog owns the a11y wiring; the inner <form> keeps its ref so the
  // Convert button (type=button by design - submit is verdict-gated) can
  // read FormData.
  return (
    <Dialog onClose={props.onCancel} ariaLabel="Convert to Bitmap" size="sm">
      <form ref={formRef} onSubmit={onSubmit} style={formStyle}>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <h2 className="lf-dialog-title">Convert to Bitmap</h2>
        </div>
        <Field label="Source">
          <span style={sourceStyle} title={props.sourceName}>
            {props.sourceName}
          </span>
        </Field>
        <fieldset disabled={props.busy} aria-label="Conversion settings" style={settingsStyle}>
          <RenderTypeField />
          <DpiField dpiText={dpiText} normalizedDpi={plan.dpi} onChange={setDpiText} />
          <BrightnessField />
        </fieldset>
        <BitmapEstimate plan={plan} />
        {props.busy ? (
          <div role="status" style={progressStyle}>
            <progress aria-label="Converting to bitmap" style={{ width: '100%' }} />
            <strong>Converting to bitmap…</strong>
            <span>You can cancel without changing your artwork.</span>
          </div>
        ) : null}
        {props.error ? (
          <div role="alert" style={errorStyle}>
            {props.error}
          </div>
        ) : null}
        <DialogActions>
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={onConvertClick}
            disabled={props.busy || plan.verdict.kind === 'too-large'}
          >
            {props.busy ? 'Converting…' : 'Convert'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function submitConvert(
  form: HTMLFormElement,
  verdictKind: ReturnType<typeof estimateBitmapConversion>['verdict']['kind'],
  onConvert: (options: ConvertToBitmapDialogOptions) => void,
): void {
  if (verdictKind === 'too-large') return;
  const data = new FormData(form);
  onConvert({
    renderType: parseRenderType(String(data.get('renderType') ?? '')),
    dpi: parseDpi(String(data.get('dpi') ?? '')),
    brightnessPercent: parseBrightness(String(data.get('brightness') ?? '')),
  });
}

function RenderTypeField(): JSX.Element {
  return (
    <Field label="Render Type">
      <select
        name="renderType"
        defaultValue="fill-all"
        className="lf-select"
        style={selectStyle}
        aria-label="Convert render type"
        title="Choose how vector artwork is drawn before it is rasterized into pixels."
        autoFocus
      >
        <option value="fill-all">Fill All</option>
        <option value="outlines">Outlines</option>
        <option value="use-cut-settings">Use Cut Settings</option>
      </select>
    </Field>
  );
}

// Numeric entry + slider, like LightBurn's DPI control pair. The slider
// tracks the normalized value; the text field keeps whatever is typed.
function DpiField(props: {
  readonly dpiText: string;
  readonly normalizedDpi: number;
  readonly onChange: (dpiText: string) => void;
}): JSX.Element {
  return (
    <Field label="DPI">
      <input
        name="dpi"
        type="number"
        min={MIN_CONVERT_TO_BITMAP_DPI}
        max={MAX_CONVERT_TO_BITMAP_DPI}
        step={1}
        value={props.dpiText}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        className="lf-input"
        style={numberStyle}
        aria-label="Convert DPI"
        title="Bitmap resolution for the rasterized vector. Higher DPI creates more pixels."
      />
      <input
        name="dpiSlider"
        type="range"
        min={MIN_CONVERT_TO_BITMAP_DPI}
        max={MAX_CONVERT_TO_BITMAP_DPI}
        step={1}
        value={props.normalizedDpi}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        style={sliderStyle}
        aria-label="Convert DPI slider"
        title="Drag to set the bitmap resolution. Same value as the DPI field."
      />
    </Field>
  );
}

// LightBurn §7.4 Default Brightness: converted pixels start at this gray
// level (default 50%). Uncontrolled — read from FormData at submit.
function BrightnessField(): JSX.Element {
  return (
    <Field label="Default Brightness">
      <input
        name="brightness"
        type="number"
        min={MIN_BRIGHTNESS_PERCENT}
        max={MAX_BRIGHTNESS_PERCENT}
        step={1}
        defaultValue={DEFAULT_BITMAP_BRIGHTNESS_PERCENT}
        className="lf-input"
        style={numberStyle}
        aria-label="Convert default brightness percent"
        title="Gray level converted pixels start at (percent). 50% matches LightBurn's default; adjust later via Adjust Image."
      />
    </Field>
  );
}

function BitmapEstimate(props: { readonly plan: ReturnType<typeof estimateBitmapConversion> }) {
  const hasError = props.plan.verdict.kind === 'too-large';
  return (
    <div role={hasError ? 'alert' : 'status'} style={hasError ? errorStyle : estimateStyle}>
      Bitmap size: {props.plan.pixelWidth} x {props.plan.pixelHeight} px
      {hasError ? ` (${props.plan.verdict.reason})` : null}
    </div>
  );
}

function parseDpi(value: string): number {
  return normalizeConvertToBitmapDpi(Number(value));
}

function parseBrightness(value: string): number {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : DEFAULT_BITMAP_BRIGHTNESS_PERCENT;
  return Math.max(MIN_BRIGHTNESS_PERCENT, Math.min(MAX_BRIGHTNESS_PERCENT, finite));
}

function parseRenderType(value: string): ConvertToBitmapRenderType {
  if (value === 'outlines' || value === 'use-cut-settings') return value;
  return 'fill-all';
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--sm">{props.label}</span>
      <span style={controlStyle}>{props.children}</span>
    </label>
  );
}

// The panel itself is the kit Dialog; this inner form only stacks rows.
const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const settingsStyle: React.CSSProperties = {
  ...formStyle,
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
};
const progressStyle: React.CSSProperties = { ...formStyle, fontSize: 13, padding: '8px 0' };
const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const sourceStyle: React.CSSProperties = {
  maxWidth: 260,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const selectStyle: React.CSSProperties = { flex: 1 };
const numberStyle: React.CSSProperties = { width: 96 };
const sliderStyle: React.CSSProperties = { flex: 1, minWidth: 120 };
const estimateStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-muted)' };
const errorStyle: React.CSSProperties = { ...estimateStyle, color: 'var(--lf-danger-fg)' };
