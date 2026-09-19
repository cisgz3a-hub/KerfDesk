import type { TextAlignment } from '../../core/scene';
import { findFontEntry } from '../../core/text';
import { FontImportButton } from './FontImportButton';
import { FontPicker } from './FontPicker';
import { FontUsageHint } from './FontUsageHint';
import { PathTextFields } from './PathTextFields';
import { TextDialogNumericFields } from './TextDialogNumericFields';
import { VariableTextFields } from './VariableTextFields';
import type { DialogFields } from './use-text-dialog-fields';

export function TextFormattingFields(props: {
  readonly fields: DialogFields;
  readonly onInsert?: (text: string) => void;
  readonly variableFields?: React.ReactNode;
}): JSX.Element {
  const { fields } = props;
  const { values } = fields;
  const outline = findFontEntry(values.fontKey)?.geometry !== 'single-line';
  return (
    <>
      {props.variableFields === undefined ? (
        <VariableTextFields
          enabled={fields.variableEnabled}
          onEnabledChange={fields.setVariableEnabled}
          onInsert={props.onInsert ?? ((source) => fields.setContent(`${values.content}${source}`))}
        />
      ) : (
        props.variableFields
      )}
      <Field label="Font">
        <FontPicker
          value={values.fontKey}
          embeddedFonts={values.embeddedFonts}
          onChange={fields.setFontKey}
        />
        <FontImportButton importFont={fields.importFont} />
        <FontUsageHint fontKey={values.fontKey} />
      </Field>
      <Field label="Alignment">
        <AlignmentRadio value={values.alignment} onChange={fields.setAlignment} />
      </Field>
      <Field label="Weld overlaps">
        <input
          type="checkbox"
          aria-label="Weld overlapping letters"
          checked={outline && (values.weldOverlaps ?? false)}
          disabled={!outline}
          title={
            outline
              ? 'Merge touching or overlapping letters into one outline while keeping the text editable.'
              : 'Single-line fonts keep their original engraving strokes.'
          }
          onChange={(event) => fields.setWeldOverlaps(event.target.checked)}
        />
        <span className="lf-muted">{outline ? 'Join script letters' : 'Outline fonts only'}</span>
      </Field>
      <TextDialogNumericFields
        values={values}
        setSizeMm={fields.setSizeMm}
        setLineHeight={fields.setLineHeight}
        setLetterSpacing={fields.setLetterSpacing}
        setBendDeg={fields.setBendDeg}
      />
      <PathTextFields
        enabled={fields.pathEnabled}
        guides={fields.guides}
        settings={
          values.pathText ?? {
            guideObjectId: fields.guides[0]?.id ?? '',
            offsetMm: 0,
            reverse: false,
          }
        }
        setEnabled={fields.setPathEnabled}
        setGuideId={fields.setPathGuideId}
        setOffsetMm={fields.setPathOffsetMm}
        setReverse={fields.setPathReverse}
      />
    </>
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

function AlignmentRadio(props: {
  readonly value: TextAlignment;
  readonly onChange: (next: TextAlignment) => void;
}): JSX.Element {
  return (
    <span style={alignmentStyle}>
      {(['left', 'center', 'right'] as const).map((alignment) => (
        <label key={alignment} style={alignmentLabelStyle}>
          <input
            type="radio"
            name="text-alignment"
            value={alignment}
            checked={props.value === alignment}
            title={`Align text ${alignment}.`}
            onChange={() => props.onChange(alignment)}
          />
          {alignment}
        </label>
      ))}
    </span>
  );
}

const fieldAlignStyle: React.CSSProperties = { alignItems: 'flex-start' };
const fieldLabelPadStyle: React.CSSProperties = { paddingTop: 4 };
const fieldControlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};
const alignmentStyle: React.CSSProperties = { display: 'flex', gap: 12 };
const alignmentLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  textTransform: 'capitalize',
};
