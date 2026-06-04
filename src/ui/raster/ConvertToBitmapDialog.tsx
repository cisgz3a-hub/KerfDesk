import { useRef } from 'react';
import { useDialogA11y } from '../common/use-dialog-a11y';
import {
  DEFAULT_CONVERT_TO_BITMAP_DPI,
  MAX_CONVERT_TO_BITMAP_DPI,
  MIN_CONVERT_TO_BITMAP_DPI,
  type ConvertToBitmapRenderType,
} from './vector-to-bitmap';

export type ConvertToBitmapDialogOptions = {
  readonly renderType: ConvertToBitmapRenderType;
  readonly dpi: number;
};

export function ConvertToBitmapDialog(props: {
  readonly sourceName: string;
  readonly onCancel: () => void;
  readonly onConvert: (options: ConvertToBitmapDialogOptions) => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogA11y(dialogRef, props.onCancel);
  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    props.onConvert({
      renderType: parseRenderType(String(data.get('renderType') ?? '')),
      dpi: parseDpi(String(data.get('dpi') ?? '')),
    });
  };
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Convert to Bitmap"
      tabIndex={-1}
      style={backdropStyle}
    >
      <form onSubmit={onSubmit} style={panelStyle}>
        <h2 style={headingStyle}>Convert to Bitmap</h2>
        <Field label="Source">
          <span style={sourceStyle} title={props.sourceName}>
            {props.sourceName}
          </span>
        </Field>
        <Field label="Render Type">
          <select
            name="renderType"
            defaultValue="fill-all"
            style={selectStyle}
            aria-label="Convert render type"
            autoFocus
          >
            <option value="fill-all">Fill All</option>
            <option value="outlines">Outlines</option>
            <option value="use-cut-settings">Use Cut Settings</option>
          </select>
        </Field>
        <Field label="DPI">
          <input
            name="dpi"
            type="number"
            min={MIN_CONVERT_TO_BITMAP_DPI}
            max={MAX_CONVERT_TO_BITMAP_DPI}
            step={1}
            defaultValue={DEFAULT_CONVERT_TO_BITMAP_DPI}
            style={numberStyle}
            aria-label="Convert DPI"
          />
        </Field>
        <div style={actionsStyle}>
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit">Convert</button>
        </div>
      </form>
    </div>
  );
}

function parseDpi(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONVERT_TO_BITMAP_DPI;
  return Math.max(MIN_CONVERT_TO_BITMAP_DPI, Math.min(MAX_CONVERT_TO_BITMAP_DPI, parsed));
}

function parseRenderType(value: string): ConvertToBitmapRenderType {
  if (value === 'outlines' || value === 'use-cut-settings') return value;
  return 'fill-all';
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{props.label}</span>
      <span style={controlStyle}>{props.children}</span>
    </label>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const panelStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 6,
  padding: 16,
  minWidth: 360,
  maxWidth: 480,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontFamily: 'system-ui, sans-serif',
};
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 16 };
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const labelStyle: React.CSSProperties = { width: 92, color: '#444' };
const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
};
const sourceStyle: React.CSSProperties = {
  maxWidth: 260,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const selectStyle: React.CSSProperties = { flex: 1 };
const numberStyle: React.CSSProperties = { width: 96 };
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
};
