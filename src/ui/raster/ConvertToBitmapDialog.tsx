import { useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import type { Bounds, Transform } from '../../core/scene';
import {
  DEFAULT_CONVERT_TO_BITMAP_DPI,
  estimateBitmapConversion,
  MAX_CONVERT_TO_BITMAP_DPI,
  MIN_CONVERT_TO_BITMAP_DPI,
  normalizeConvertToBitmapDpi,
} from './bitmap-conversion-plan';
import { type ConvertToBitmapRenderType } from './vector-to-bitmap';

export type ConvertToBitmapDialogOptions = {
  readonly renderType: ConvertToBitmapRenderType;
  readonly dpi: number;
};

export function ConvertToBitmapDialog(props: {
  readonly sourceName: string;
  readonly bounds: Bounds;
  readonly transform: Transform;
  readonly onCancel: () => void;
  readonly onConvert: (options: ConvertToBitmapDialogOptions) => void;
}): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  // Raw text, NOT a clamped number: clamping every keystroke made typed DPI
  // entry impossible (any first digit is below the minimum and snapped to it).
  // The live estimate and the submit normalize; the field never fights back.
  const [dpiText, setDpiText] = useState(String(DEFAULT_CONVERT_TO_BITMAP_DPI));
  const plan = useMemo(
    () =>
      estimateBitmapConversion(
        { bounds: props.bounds, transform: props.transform },
        parseDpi(dpiText),
      ),
    [dpiText, props.bounds, props.transform],
  );
  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    submitConvert(form, plan.verdict.kind, props.onConvert);
  };
  const onConvertClick = (): void => {
    if (formRef.current === null) return;
    submitConvert(formRef.current, plan.verdict.kind, props.onConvert);
  };
  // kit Dialog owns the a11y wiring; the inner <form> keeps its ref so the
  // Convert button (type=button by design - submit is verdict-gated) can
  // read FormData.
  return (
    <Dialog onClose={props.onCancel} ariaLabel="Convert to Bitmap" size="sm">
      <form ref={formRef} onSubmit={onSubmit} style={formStyle}>
        <h2 className="lf-dialog-title">Convert to Bitmap</h2>
        <Field label="Source">
          <span style={sourceStyle} title={props.sourceName}>
            {props.sourceName}
          </span>
        </Field>
        <RenderTypeField />
        <DpiField dpiText={dpiText} onChange={setDpiText} />
        <BitmapEstimate plan={plan} />
        <DialogActions>
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={onConvertClick}
            disabled={plan.verdict.kind === 'too-large'}
          >
            Convert
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

// The text field keeps whatever is typed; parsing clamps at submit.
function DpiField(props: {
  readonly dpiText: string;
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
const estimateStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-muted)' };
const errorStyle: React.CSSProperties = { ...estimateStyle, color: 'var(--lf-danger-fg)' };
