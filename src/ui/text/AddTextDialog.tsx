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
import { bendTextRender, placeTextOnPath } from '../../core/text';
import { IDENTITY_TRANSFORM, type TextAlignment, type TextObject } from '../../core/scene';
import { parseVariableTemplateSource } from '../../core/variables';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { FontImportButton } from './FontImportButton';
import { FontPicker } from './FontPicker';
import { FontUsageHint } from './FontUsageHint';
import { renderTextGeometry } from './render-text-geometry';
import { PathTextFields } from './PathTextFields';
import { TextLayerField } from './TextLayerField';
import { VariableTextFields } from './VariableTextFields';
import {
  sanitizeTextDialogNumericValues,
  TextDialogNumericFields,
  type TextDialogNumericValues,
} from './TextDialogNumericFields';
import {
  useTextDialogFields,
  type DialogFields,
  type DialogValues,
} from './use-text-dialog-fields';

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
  const activeLayerColor = useUiStore((s) => s.activeLayerColor);
  const setActiveLayerColor = useUiStore((s) => s.setActiveLayerColor);
  const pushToast = useToastStore((s) => s.pushToast);
  const fields = useTextDialogFields(state, project, selectedObjectId, activeLayerColor);
  const [submitting, setSubmitting] = useState(false);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void commitText(state, fields.values, {
      upsert,
      close,
      pushToast,
      setSubmitting,
      setActiveLayerColor,
    });
  };
  // kit Dialog owns the a11y wiring (Escape closes, Tab cycles, focus
  // returns to the opener) and the aria-label.
  return (
    <Dialog onClose={close} ariaLabel="Add or edit text" as="form" onSubmit={onSubmit} size="sm">
      <h2 className="lf-dialog-title">{state.mode === 'add' ? 'Add Text' : 'Edit Text'}</h2>
      <FormFields fields={fields} />
      <FormActions
        mode={state.mode}
        canSubmit={
          fields.values.content.trim() !== '' &&
          fields.fontAvailable &&
          fields.pathAvailable &&
          fields.layerCompatible &&
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
    readonly setActiveLayerColor: (color: string | null) => void;
  },
): Promise<void> {
  const normalizedContent = normalizeTextContent(v.content);
  if (normalizedContent.trim() === '') {
    ctx.pushToast('Type some text first.', 'warning');
    return;
  }
  const safeValues = sanitizeTextDialogNumericValues(v);
  const variable = fieldsVariableTemplate(v);
  if (!variable.ok) {
    ctx.pushToast(variable.message, 'error');
    return;
  }
  ctx.setSubmitting(true);
  try {
    const rawRendered = await renderTextGeometry({
      fontKey: v.fontKey,
      embeddedFonts: v.embeddedFonts,
      content: normalizedContent,
      sizeMm: safeValues.sizeMm,
      alignment: v.alignment,
      lineHeight: safeValues.lineHeight,
      letterSpacing: safeValues.letterSpacing,
      color: v.color,
    });
    const placed = placeRenderedText(rawRendered, safeValues, v);
    const obj: TextObject = {
      kind: 'text',
      id: state.mode === 'edit' ? state.id : crypto.randomUUID(),
      content: normalizedContent,
      fontKey: v.fontKey,
      sizeMm: safeValues.sizeMm,
      alignment: v.alignment,
      lineHeight: safeValues.lineHeight,
      letterSpacing: safeValues.letterSpacing,
      bendDeg: v.pathText === undefined ? safeValues.bendDeg : 0,
      color: v.color,
      ...(v.pathText === undefined ? {} : { pathText: v.pathText }),
      ...(variable.template === undefined ? {} : { variableTemplate: variable.template }),
      bounds: placed.rendered.bounds,
      transform: placed.transform,
      paths: placed.rendered.paths,
    };
    ctx.upsert(obj, v.importedFont);
    ctx.setActiveLayerColor(v.color);
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
    setBendDeg,
  } = props.fields;
  return (
    <>
      <ContentField value={values.content} onChange={setContent} />
      <VariableTextFields
        enabled={props.fields.variableEnabled}
        onEnabledChange={props.fields.setVariableEnabled}
        onInsert={(source) => setContent(`${values.content}${source}`)}
      />
      <Field label="Font">
        <FontPicker
          value={values.fontKey}
          embeddedFonts={values.embeddedFonts}
          onChange={setFontKey}
        />
        <FontImportButton importFont={props.fields.importFont} />
        <FontUsageHint fontKey={values.fontKey} />
      </Field>
      <Field label="Alignment">
        <AlignmentRadio value={values.alignment} onChange={setAlignment} />
      </Field>
      <TextLayerField
        value={values.color}
        options={props.fields.layerOptions}
        {...(props.fields.layerNotice === undefined ? {} : { notice: props.fields.layerNotice })}
        onChange={props.fields.setColor}
      />
      <TextDialogNumericFields
        values={values}
        setSizeMm={setSizeMm}
        setLineHeight={setLineHeight}
        setLetterSpacing={setLetterSpacing}
        setBendDeg={setBendDeg}
      />
      <PathTextFields
        enabled={props.fields.pathEnabled}
        guides={props.fields.guides}
        settings={
          values.pathText ?? {
            guideObjectId: props.fields.guides[0]?.id ?? '',
            offsetMm: 0,
            reverse: false,
          }
        }
        setEnabled={props.fields.setPathEnabled}
        setGuideId={props.fields.setPathGuideId}
        setOffsetMm={props.fields.setPathOffsetMm}
        setReverse={props.fields.setPathReverse}
      />
    </>
  );
}

function fieldsVariableTemplate(
  values: DialogValues,
):
  | { readonly ok: true; readonly template?: NonNullable<TextObject['variableTemplate']> }
  | { readonly ok: false; readonly message: string } {
  if (values.variableTemplate === undefined) return { ok: true };
  return parseVariableTemplateSource(values.content);
}

function placeRenderedText(
  rendered: Awaited<ReturnType<typeof renderTextGeometry>>,
  safeValues: TextDialogNumericValues,
  values: DialogValues,
): {
  readonly rendered: Awaited<ReturnType<typeof renderTextGeometry>>;
  readonly transform: typeof IDENTITY_TRANSFORM;
} {
  if (values.pathText === undefined) {
    return {
      rendered: bendTextRender(rendered, safeValues.bendDeg),
      transform: IDENTITY_TRANSFORM,
    };
  }
  if (values.pathGuide === undefined) throw new Error('Select a guide path for this text.');
  const result = placeTextOnPath(rendered, values.pathGuide, values.pathText);
  if (result.kind !== 'ok') throw new Error(result.message);
  return {
    rendered: result.rendered,
    transform: { ...IDENTITY_TRANSFORM, x: result.origin.x, y: result.origin.y },
  };
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
