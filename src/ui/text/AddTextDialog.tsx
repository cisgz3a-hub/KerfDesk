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
  encodeEmbeddedFont,
  FONT_REGISTRY,
  textToPolylines,
} from '../../core/text';
import {
  DEFAULT_TEXT_ALIGNMENT,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_LETTER_SPACING,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE_MM,
} from '../../core/text';
import {
  IDENTITY_TRANSFORM,
  type EmbeddedFont,
  type TextAlignment,
  type TextObject,
} from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { loadFont } from './font-loader';
import { FontImportButton } from './FontImportButton';
import { FontPicker } from './FontPicker';
import {
  initialTextLetterSpacing,
  initialTextLineHeight,
  initialTextSizeMm,
  sanitizeTextDialogNumericValues,
  TextDialogNumericFields,
  type TextDialogNumericValues,
} from './TextDialogNumericFields';

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
  const embeddedFonts = useStore((s) => s.project.embeddedFonts ?? []);
  const pushToast = useToastStore((s) => s.pushToast);
  const fields = useTextDialogFields(state, embeddedFonts);
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
        canSubmit={fields.values.content.trim() !== '' && fields.fontAvailable && !submitting}
        submitting={submitting}
        onCancel={close}
      />
    </Dialog>
  );
}

type DialogValues = TextDialogNumericValues & {
  content: string;
  fontKey: string;
  alignment: TextAlignment;
  embeddedFonts: ReadonlyArray<EmbeddedFont>;
  importedFont?: EmbeddedFont;
};

type DialogFields = {
  readonly values: DialogValues;
  readonly setContent: (v: string) => void;
  readonly setFontKey: (v: string) => void;
  readonly setSizeMm: (v: number) => void;
  readonly setAlignment: (v: TextAlignment) => void;
  readonly setLineHeight: (v: number) => void;
  readonly setLetterSpacing: (v: number) => void;
  readonly importFont: (file: File) => Promise<void>;
  readonly fontAvailable: boolean;
};

function useTextDialogFields(
  state: NonNullable<ReturnType<typeof useUiStore.getState>['textDialog']>,
  projectFonts: ReadonlyArray<EmbeddedFont>,
): DialogFields {
  const [content, setContent] = useState(state.mode === 'edit' ? state.content : '');
  const [fontKey, setFontKey] = useState<string>(
    state.mode === 'edit' ? state.fontKey : DEFAULT_FONT_KEY,
  );
  const [sizeMm, setSizeMm] = useState(
    initialTextSizeMm(state.mode === 'edit' ? state.sizeMm : DEFAULT_TEXT_SIZE_MM),
  );
  const [alignment, setAlignment] = useState<TextAlignment>(
    state.mode === 'edit' ? state.alignment : DEFAULT_TEXT_ALIGNMENT,
  );
  const [lineHeight, setLineHeight] = useState(
    initialTextLineHeight(state.mode === 'edit' ? state.lineHeight : DEFAULT_TEXT_LINE_HEIGHT),
  );
  const [letterSpacing, setLetterSpacing] = useState(
    initialTextLetterSpacing(
      state.mode === 'edit' ? state.letterSpacing : DEFAULT_TEXT_LETTER_SPACING,
    ),
  );
  const [importedFont, setImportedFont] = useState<EmbeddedFont | undefined>();
  const embeddedFonts = importedFont === undefined ? projectFonts : [...projectFonts, importedFont];
  const importFont = async (file: File): Promise<void> => {
    if (!/\.(ttf|otf)$/i.test(file.name)) throw new Error('Choose a .ttf or .otf font file.');
    const font = encodeEmbeddedFont({
      key: `embedded:${crypto.randomUUID()}`,
      fileName: file.name,
      buffer: await file.arrayBuffer(),
    });
    setImportedFont(font);
    setFontKey(font.key);
  };
  return {
    values: {
      content,
      fontKey,
      sizeMm,
      alignment,
      lineHeight,
      letterSpacing,
      embeddedFonts,
      ...(importedFont === undefined ? {} : { importedFont }),
    },
    setContent,
    setFontKey,
    setSizeMm,
    setAlignment,
    setLineHeight,
    setLetterSpacing,
    importFont,
    fontAvailable:
      FONT_REGISTRY.some((font) => font.key === fontKey) ||
      embeddedFonts.some((font) => font.key === fontKey),
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
  const normalizedContent = normalizeTextContent(v.content);
  if (normalizedContent.trim() === '') {
    ctx.pushToast('Type some text first.', 'warning');
    return;
  }
  const safeValues = sanitizeTextDialogNumericValues(v);
  ctx.setSubmitting(true);
  try {
    const buffer = await loadFont(v.fontKey, v.embeddedFonts);
    const rendered = await textToPolylines({
      fontBuffer: buffer,
      content: normalizedContent,
      sizeMm: safeValues.sizeMm,
      alignment: v.alignment,
      lineHeight: safeValues.lineHeight,
      letterSpacing: safeValues.letterSpacing,
      color: state.mode === 'edit' ? state.color : DEFAULT_TEXT_COLOR,
    });
    const obj: TextObject = {
      kind: 'text',
      id: state.mode === 'edit' ? state.id : crypto.randomUUID(),
      content: normalizedContent,
      fontKey: v.fontKey,
      sizeMm: safeValues.sizeMm,
      alignment: v.alignment,
      lineHeight: safeValues.lineHeight,
      letterSpacing: safeValues.letterSpacing,
      color: state.mode === 'edit' ? state.color : DEFAULT_TEXT_COLOR,
      bounds: rendered.bounds,
      transform: IDENTITY_TRANSFORM,
      paths: rendered.paths,
    };
    ctx.upsert(obj, v.importedFont);
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
      <ContentField value={values.content} onChange={setContent} />
      <Field label="Font">
        <FontPicker
          value={values.fontKey}
          embeddedFonts={values.embeddedFonts}
          onChange={setFontKey}
        />
        <FontImportButton importFont={props.fields.importFont} />
      </Field>
      <Field label="Alignment">
        <AlignmentRadio value={values.alignment} onChange={setAlignment} />
      </Field>
      <TextDialogNumericFields
        values={values}
        setSizeMm={setSizeMm}
        setLineHeight={setLineHeight}
        setLetterSpacing={setLetterSpacing}
      />
    </>
  );
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

function normalizeTextContent(text: string): string {
  return text.normalize('NFC');
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
            title={`Align text ${a}.`}
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
const alignmentStyle: React.CSSProperties = { display: 'flex', gap: 12 };
const alignmentLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  textTransform: 'capitalize',
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
