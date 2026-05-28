// AddTextDialog — Phase D's add/edit text modal.
//
// Opens when useUiStore.textDialog is non-null. The Toolbar fires
// openTextDialog({mode:'add'}) for a fresh text; the Workspace fires
// openTextDialog({mode:'edit', ...}) for an existing one. Submit
// calls upsertTextObject(text) which adds or replaces by id; close
// happens automatically on submit success or via Cancel.
//
// Renders the text via textToPolylines on submit (font fetched +
// cached by font-loader). For multi-line content / non-Latin
// scripts opentype's getPath handles word-spacing and Unicode glyph
// lookup; we just split on '\n' for line breaks.

import { useRef, useState } from 'react';
import {
  DEFAULT_FONT_KEY,
  FONT_REGISTRY,
  type KnownFontKey,
  textToPolylines,
} from '../../core/text';
import {
  DEFAULT_TEXT_ALIGNMENT,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_LETTER_SPACING,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE_MM,
} from '../../core/text';
import { IDENTITY_TRANSFORM, type TextAlignment, type TextObject } from '../../core/scene';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { loadFont } from './font-loader';
import { FontPicker } from './FontPicker';

export function AddTextDialog(): JSX.Element | null {
  const state = useUiStore((s) => s.textDialog);
  if (state === null) return null;
  // Re-mount the form on each open so React fully reinitializes
  // local state for the new mode/object. The key uses `mode + id?`
  // so editing two different text objects in succession doesn't
  // show stale fields from the previous one.
  const key = state.mode === 'edit' ? `edit:${state.id}` : 'add';
  return <DialogForm key={key} state={state} />;
}

function DialogForm(props: {
  readonly state: NonNullable<ReturnType<typeof useUiStore.getState>['textDialog']>;
}): JSX.Element {
  const { state } = props;
  const close = useUiStore((s) => s.closeTextDialog);
  const upsert = useStore((s) => s.upsertTextObject);
  const pushToast = useToastStore((s) => s.pushToast);
  const fields = useTextDialogFields(state);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // R-M1 a11y: Escape closes, Tab cycles within, focus returns to the
  // toolbar button on close. Hook installs keydown listener and
  // initial-focus + cleanup-focus behaviour.
  useDialogA11y(dialogRef, close);
  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    void commitText(state, fields.values, { upsert, close, pushToast, setSubmitting });
  };
  return (
    <div
      ref={dialogRef}
      style={backdropStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Add or edit text"
      tabIndex={-1}
    >
      <form onSubmit={onSubmit} style={panelStyle}>
        <h2 style={headingStyle}>{state.mode === 'add' ? 'Add Text' : 'Edit Text'}</h2>
        <FormFields fields={fields} />
        <DialogActions
          mode={state.mode}
          canSubmit={fields.values.content.trim() !== '' && !submitting}
          submitting={submitting}
          onCancel={close}
        />
      </form>
    </div>
  );
}

type DialogValues = {
  content: string;
  fontKey: string;
  sizeMm: number;
  alignment: TextAlignment;
  lineHeight: number;
  letterSpacing: number;
};

type DialogFields = {
  readonly values: DialogValues;
  readonly setContent: (v: string) => void;
  readonly setFontKey: (v: string) => void;
  readonly setSizeMm: (v: number) => void;
  readonly setAlignment: (v: TextAlignment) => void;
  readonly setLineHeight: (v: number) => void;
  readonly setLetterSpacing: (v: number) => void;
};

function useTextDialogFields(
  state: NonNullable<ReturnType<typeof useUiStore.getState>['textDialog']>,
): DialogFields {
  const [content, setContent] = useState(state.mode === 'edit' ? state.content : '');
  const [fontKey, setFontKey] = useState<string>(
    state.mode === 'edit' ? state.fontKey : DEFAULT_FONT_KEY,
  );
  const [sizeMm, setSizeMm] = useState(state.mode === 'edit' ? state.sizeMm : DEFAULT_TEXT_SIZE_MM);
  const [alignment, setAlignment] = useState<TextAlignment>(
    state.mode === 'edit' ? state.alignment : DEFAULT_TEXT_ALIGNMENT,
  );
  const [lineHeight, setLineHeight] = useState(
    state.mode === 'edit' ? state.lineHeight : DEFAULT_TEXT_LINE_HEIGHT,
  );
  const [letterSpacing, setLetterSpacing] = useState(
    state.mode === 'edit' ? state.letterSpacing : DEFAULT_TEXT_LETTER_SPACING,
  );
  return {
    values: { content, fontKey, sizeMm, alignment, lineHeight, letterSpacing },
    setContent,
    setFontKey,
    setSizeMm,
    setAlignment,
    setLineHeight,
    setLetterSpacing,
  };
}

async function commitText(
  state: NonNullable<ReturnType<typeof useUiStore.getState>['textDialog']>,
  v: DialogValues,
  ctx: {
    readonly upsert: ReturnType<typeof useStore.getState>['upsertTextObject'];
    readonly close: () => void;
    readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
    readonly setSubmitting: (v: boolean) => void;
  },
): Promise<void> {
  if (v.content.trim() === '') {
    ctx.pushToast('Type some text first.', 'warning');
    return;
  }
  ctx.setSubmitting(true);
  try {
    const buffer = await loadFont(asKnownFontKey(v.fontKey));
    const rendered = await textToPolylines({
      fontBuffer: buffer,
      content: v.content,
      sizeMm: v.sizeMm,
      alignment: v.alignment,
      lineHeight: v.lineHeight,
      letterSpacing: v.letterSpacing,
      color: state.mode === 'edit' ? state.color : DEFAULT_TEXT_COLOR,
    });
    const obj: TextObject = {
      kind: 'text',
      id: state.mode === 'edit' ? state.id : crypto.randomUUID(),
      content: v.content,
      fontKey: v.fontKey,
      sizeMm: v.sizeMm,
      alignment: v.alignment,
      lineHeight: v.lineHeight,
      letterSpacing: v.letterSpacing,
      color: state.mode === 'edit' ? state.color : DEFAULT_TEXT_COLOR,
      bounds: rendered.bounds,
      transform: IDENTITY_TRANSFORM,
      paths: rendered.paths,
    };
    ctx.upsert(obj);
    ctx.close();
  } catch (err) {
    ctx.pushToast(
      `Could not render text: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  } finally {
    ctx.setSubmitting(false);
  }
}

function FormFields(props: { readonly fields: DialogFields }): JSX.Element {
  const {
    values,
    setContent,
    setFontKey,
    setSizeMm,
    setAlignment,
    setLineHeight,
    setLetterSpacing,
  } = props.fields;
  return (
    <>
      <Field label="Content">
        <textarea
          value={values.content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          style={textareaStyle}
          autoFocus
        />
      </Field>
      <Field label="Font">
        <FontPicker value={values.fontKey} onChange={setFontKey} />
      </Field>
      <Field label="Size">
        <input
          type="number"
          min={1}
          step={1}
          value={values.sizeMm}
          onChange={(e) => setSizeMm(Math.max(1, Number(e.target.value) || 0))}
          style={numStyle}
        />
        <span style={unitStyle}>mm</span>
      </Field>
      <Field label="Alignment">
        <AlignmentRadio value={values.alignment} onChange={setAlignment} />
      </Field>
      <Field label="Line height">
        <input
          type="number"
          min={0.5}
          max={5}
          step={0.1}
          value={values.lineHeight}
          onChange={(e) => setLineHeight(Math.max(0.5, Number(e.target.value) || 1))}
          style={numStyle}
        />
        <span style={unitStyle}>× size</span>
      </Field>
      <Field label="Spacing">
        <input
          type="number"
          min={-0.5}
          max={2}
          step={0.05}
          value={values.letterSpacing}
          onChange={(e) => setLetterSpacing(Number(e.target.value) || 0)}
          style={numStyle}
          title="Letter spacing (tracking). 0 = font's natural spacing. Positive widens, negative tightens."
        />
        <span style={unitStyle}>× size (0 = natural)</span>
      </Field>
    </>
  );
}

function DialogActions(props: {
  readonly mode: 'add' | 'edit';
  readonly canSubmit: boolean;
  readonly submitting: boolean;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div style={actionsStyle}>
      <button type="button" onClick={props.onCancel} disabled={props.submitting}>
        Cancel
      </button>
      <button type="submit" disabled={!props.canSubmit}>
        {props.submitting ? 'Rendering…' : props.mode === 'add' ? 'Add' : 'Save'}
      </button>
    </div>
  );
}

// Narrow a stored fontKey string back to KnownFontKey for the
// loader. Unknown keys fall back to the default (so .lf2 files from
// a future build that referenced an unbundled font still render in
// something rather than crash).
function asKnownFontKey(key: string): KnownFontKey {
  if (FONT_REGISTRY.some((f) => f.key === key)) return key as KnownFontKey;
  return DEFAULT_FONT_KEY;
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{props.label}</span>
      <span style={fieldControlStyle}>{props.children}</span>
    </label>
  );
}

function AlignmentRadio(props: {
  readonly value: TextAlignment;
  readonly onChange: (next: TextAlignment) => void;
}): JSX.Element {
  return (
    <span style={alignmentStyle}>
      {(['left', 'center', 'right'] as const).map((a) => (
        <label key={a} style={alignmentLabelStyle}>
          <input
            type="radio"
            name="text-alignment"
            value={a}
            checked={props.value === a}
            onChange={() => props.onChange(a)}
          />
          {a}
        </label>
      ))}
    </span>
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
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 13,
};
const fieldLabelStyle: React.CSSProperties = { width: 90, paddingTop: 4, color: '#444' };
const fieldControlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};
const textareaStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: 'inherit',
  fontSize: 13,
  resize: 'vertical',
};
const numStyle: React.CSSProperties = { width: 80 };
const unitStyle: React.CSSProperties = { fontSize: 11, color: '#666' };
const alignmentStyle: React.CSSProperties = { display: 'flex', gap: 12 };
const alignmentLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  textTransform: 'capitalize',
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
};
