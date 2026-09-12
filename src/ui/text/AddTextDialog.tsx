// AddTextDialog — Phase D's add/edit text modal.
//
// Opens when useUiStore.textDialog is non-null. The Toolbar fires
// openTextDialog({mode:'add'}) for a fresh text; the Workspace fires
// openTextDialog({mode:'edit', ...}) for an existing one. Submit
// calls upsertTextObject(text) which adds or replaces by id; close
// happens automatically on submit success or via Cancel.
//
// Renders the text via textToPolylines on submit (outline fonts are fetched +
// cached by font-loader; native stroke fonts use their bundled paths).
// For multi-line content / non-Latin
// scripts opentype's getPath handles word-spacing and Unicode glyph
// lookup; we just split on '\n' for line breaks.

import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { buildTextObject, TextObjectValidationError } from './build-text-object';
import { TextFormattingFields } from './TextFormattingFields';
import { useTextDialogFields, type DialogValues } from './use-text-dialog-fields';

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
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const pushToast = useToastStore((s) => s.pushToast);
  const fields = useTextDialogFields(state, project, selectedObjectId);
  const [submitting, setSubmitting] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const unsubscribe = useStore.subscribe((next, previous) => {
      if (
        next.projectDocumentEpoch !== previous.projectDocumentEpoch &&
        useUiStore.getState().textDialog === state
      )
        close();
    });
    return () => {
      request.current += 1;
      unsubscribe();
    };
  }, [close, state]);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const token = ++request.current;
    const epoch = useStore.getState().projectDocumentEpoch;
    void commitText(state, fields.values, {
      upsert,
      close,
      pushToast,
      setSubmitting,
      isCurrent: () =>
        request.current === token &&
        useUiStore.getState().textDialog === state &&
        useStore.getState().projectDocumentEpoch === epoch,
    });
  };
  // kit Dialog owns the a11y wiring (Escape closes, Tab cycles, focus
  // returns to the opener) and the aria-label.
  return (
    <Dialog onClose={close} ariaLabel="Add or edit text" as="form" onSubmit={onSubmit} size="sm">
      <h2 className="lf-dialog-title">{state.mode === 'add' ? 'Add Text' : 'Edit Text'}</h2>
      <ContentField value={fields.values.content} onChange={fields.setContent} />
      <TextFormattingFields fields={fields} />
      <FormActions
        mode={state.mode}
        canSubmit={
          fields.values.content.trim() !== '' &&
          fields.fontAvailable &&
          fields.pathAvailable &&
          !submitting
        }
        submitting={submitting}
        onCancel={close}
      />
    </Dialog>
  );
}

async function commitText(
  state: NonNullable<ReturnType<typeof useUiStore.getState>['textDialog']>,
  v: DialogValues,
  ctx: {
    readonly upsert: ReturnType<typeof useStore.getState>['upsertTextObject'];
    readonly close: () => void;
    readonly pushToast: ReturnType<typeof useToastStore.getState>['pushToast'];
    readonly setSubmitting: (v: boolean) => void;
    readonly isCurrent: () => boolean;
  },
): Promise<void> {
  ctx.setSubmitting(true);
  try {
    const obj = await buildTextObject(state, v);
    if (!ctx.isCurrent()) return;
    ctx.upsert(obj, v.importedFont);
    ctx.close();
  } catch (err) {
    if (!ctx.isCurrent()) return;
    if (err instanceof TextObjectValidationError) ctx.pushToast(err.message, err.severity);
    else {
      ctx.pushToast(
        `Could not render text: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  } finally {
    if (ctx.isCurrent()) ctx.setSubmitting(false);
  }
}

function ContentField(props: {
  readonly value: string;
  readonly onChange: (v: string) => void;
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const insertDiacritic = (char: string): void => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      props.onChange(`${props.value}${char}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${props.value.slice(0, start)}${char}${props.value.slice(end)}`;
    props.onChange(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + char.length;
      textarea.setSelectionRange(caret, caret);
    });
  };
  return (
    <Field label="Content">
      <textarea
        ref={textareaRef}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={3}
        className="lf-input"
        style={textareaStyle}
        aria-label="Text content"
        title="Text content to render as editable vector paths."
        autoFocus
      />
      <span style={diacriticsStyle}>
        {DIACRITIC_INSERTS.map((char) => (
          <button
            key={char}
            type="button"
            className="lf-btn"
            style={diacriticButtonStyle}
            title={`Insert ${char}`}
            aria-label={`Insert ${char}`}
            onClick={() => insertDiacritic(char)}
          >
            {char}
          </button>
        ))}
      </span>
    </Field>
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
const DIACRITIC_INSERTS = [
  'é',
  'è',
  'ê',
  'ë',
  'á',
  'à',
  'â',
  'ä',
  'í',
  'ó',
  'ú',
  'ñ',
  'ç',
  'ü',
  '´',
] as const;
const diacriticsStyle: React.CSSProperties = {
  flexBasis: '100%',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};
const diacriticButtonStyle: React.CSSProperties = {
  minWidth: 28,
  height: 26,
  padding: '0 6px',
  justifyContent: 'center',
};
