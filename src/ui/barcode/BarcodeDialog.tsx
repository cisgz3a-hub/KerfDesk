// BarcodeDialog — insert or edit a barcode (ADR-372). Every change re-encodes
// the code for the live preview; invalid data shows why inline and disables
// the action, so a wrong code is never inserted. Variable data previews the
// value the next output would encode.

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import type { BarcodeLayout, BarcodeShape } from '../../core/barcode';
import type { Project, SceneObject } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { previewBarcode, type BarcodePreview } from './barcode-form';
import { BarcodeFields } from './BarcodeFields';
import { BarcodePreviewSvg } from './BarcodePreviewSvg';
import { useBarcodeForm } from './use-barcode-form';

export type BarcodeSubmit = (spec: BarcodeShape, value: string) => Promise<string | null>;

export function BarcodeDialog(props: {
  readonly mode: 'insert' | 'edit';
  readonly initial: BarcodeShape;
  readonly project: Project;
  /** Variable fields such as power read this object's operation. */
  readonly subject: SceneObject;
  readonly clock?: () => Date;
  readonly onCancel: () => void;
  /** Resolves to an error message, or null once the code is in the scene. */
  readonly onSubmit: BarcodeSubmit;
}): JSX.Element {
  const form = useBarcodeForm(props.initial);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const lastLayout = useRef<BarcodeLayout | null>(null);
  const { clock, project, subject } = props;
  // Encoding a large QR Code takes a few milliseconds; only redo it on change.
  const preview = useMemo(
    () => previewBarcode(form.draft, { project, object: subject, now: (clock ?? now)() }),
    [form.draft, project, subject, clock],
  );
  if (preview.kind === 'ready') lastLayout.current = preview.layout;
  const submit = async (): Promise<void> => {
    if (preview.kind !== 'ready' || busy) return;
    setBusy(true);
    setSubmitError(null);
    const error = await props.onSubmit(preview.spec, preview.value);
    // Success closes the dialog; only a failure leaves it mounted.
    if (error !== null) {
      setSubmitError(error);
      setBusy(false);
    }
  };
  return (
    <Dialog
      onClose={props.onCancel}
      title={props.mode === 'insert' ? 'Insert Barcode' : 'Edit Barcode'}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      size="md"
    >
      <BarcodeFields form={form} />
      <BarcodePreviewSvg layout={lastLayout.current} stale={preview.kind !== 'ready'} />
      <PreviewMessages preview={preview} submitError={submitError} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={preview.kind !== 'ready' || busy}>
          {props.mode === 'insert' ? 'Insert' : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function now(): Date {
  return new Date();
}

function PreviewMessages(props: {
  readonly preview: BarcodePreview;
  readonly submitError: string | null;
}): JSX.Element {
  const { preview } = props;
  const errors = [
    ...(preview.kind === 'invalid' ? [preview.message] : []),
    ...(props.submitError === null ? [] : [props.submitError]),
  ];
  return (
    <div style={messagesStyle}>
      {preview.kind === 'ready' ? <p style={summaryStyle}>{summary(preview)}</p> : null}
      {errors.length === 0 ? null : (
        <div role="alert">
          {errors.map((error) => (
            <p key={error} style={errorStyle}>
              {error}
            </p>
          ))}
        </div>
      )}
      {preview.kind === 'ready'
        ? [...preview.layout.warnings, ...preview.notes].map((line) => (
            <p key={line} style={preview.layout.warnings.includes(line) ? warningStyle : noteStyle}>
              {line}
            </p>
          ))
        : null}
    </div>
  );
}

function summary(preview: Extract<BarcodePreview, { readonly kind: 'ready' }>): string {
  const { layout } = preview;
  return (
    `${layout.description} · ${mm(layout.widthMm)} × ${mm(layout.heightMm)} mm · ` +
    `module ${mm(layout.moduleMm)} mm`
  );
}

function mm(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const messagesStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  margin: '6px 0',
};
const summaryStyle: CSSProperties = {
  fontSize: 'var(--lf-text-xs)',
  color: 'var(--lf-text-muted)',
  margin: 0,
};
const errorStyle: CSSProperties = {
  fontSize: 'var(--lf-text-xs)',
  color: 'var(--lf-danger-fg)',
  margin: 0,
};
const warningStyle: CSSProperties = { ...errorStyle, color: 'var(--lf-warning-fg)' };
const noteStyle: CSSProperties = { ...errorStyle, color: 'var(--lf-text-muted)' };
