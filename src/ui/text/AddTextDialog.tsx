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

import { useState } from 'react';
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
import { Button, Dialog, DialogActions } from '../kit';
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
  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void commitText(state, fields.values, { upsert, close, pushToast, setSubmitting });
  };
  // kit Dialog owns the a11y wiring (Escape closes, Tab cycles, focus
  // returns to the opener) and the aria-label.
  return (
    <Dialog onClose={close} ariaLabel="Add or edit text" as="form" onSubmit={onSubmit} size="sm">
      <h2 className="lf-dialog-title">{state.mode === 'add' ? 'Add Text' : 'Edit Text'}</h2>
      <FormFields fields={fields} />
      <FormActions
        mode={state.mode}
        canSubmit={fields.values.content.trim() !== '' && !submitting}
        submitting={submitting}
        onCancel={close}
      />
    </Dialog>
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
    const knownFontKey = asKnownFontKey(v.fontKey);
    const substitutedFont = knownFontKey !== v.fontKey;
    const buffer = await loadFont(knownFontKey);
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
      fontKey: knownFontKey,
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
    if (substitutedFont) {
      ctx.pushToast(
        `Missing font "${v.fontKey}" was substituted with ${fontDisplayName(knownFontKey)}.`,
        'warning',
      );
    }
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
          className="lf-input"
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
          className="lf-input"
          style={numStyle}
        />
        <span className="lf-field-unit">mm</span>
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
          className="lf-input"
          style={numStyle}
        />
        <span className="lf-field-unit">× size</span>
      </Field>
      <Field label="Spacing">
        <input
          type="number"
          min={-0.5}
          max={2}
          step={0.05}
          value={values.letterSpacing}
          onChange={(e) => setLetterSpacing(Number(e.target.value) || 0)}
          className="lf-input"
          style={numStyle}
          title="Letter spacing (tracking). 0 = font's natural spacing. Positive widens, negative tightens."
        />
        <span className="lf-field-unit">× size (0 = natural)</span>
      </Field>
    </>
  );
}

function FormActions(props: {
  readonly mode: 'add' | 'edit';
  readonly canSubmit: boolean;
  readonly submitting: boolean;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <DialogActions>
      <Button onClick={props.onCancel} disabled={props.submitting}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={!props.canSubmit}>
        {props.submitting ? 'Rendering…' : props.mode === 'add' ? 'Add' : 'Save'}
      </Button>
    </DialogActions>
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

function fontDisplayName(key: KnownFontKey): string {
  return FONT_REGISTRY.find((f) => f.key === key)?.displayName ?? key;
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label className="lf-field" style={fieldAlignStyle}>
      <span className="lf-field-label lf-field-label--sm" style={fieldLabelPadStyle}>
        {props.label}
      </span>
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

// Multi-line rows (textarea, wrapped radios) top-align, unlike .lf-field's
// default center alignment - layout-only overrides per ADR-047.
const fieldAlignStyle: React.CSSProperties = { alignItems: 'flex-start' };
const fieldLabelPadStyle: React.CSSProperties = { paddingTop: 4 };
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
const alignmentStyle: React.CSSProperties = { display: 'flex', gap: 12 };
const alignmentLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  textTransform: 'capitalize',
};
