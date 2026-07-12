import {
  DEFAULT_TEXT_LETTER_SPACING,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE_MM,
  TEXT_BEND_MAX_DEG,
  TEXT_BEND_MIN_DEG,
  clampBend,
} from '../../core/text';
import { NumberField } from '../common/NumberField';

const TEXT_SIZE_MIN_MM = 1;
const TEXT_SIZE_MAX_MM = 300;
const TEXT_LINE_HEIGHT_MIN = 0.5;
const TEXT_LINE_HEIGHT_MAX = 5;
const TEXT_LETTER_SPACING_MIN = -0.5;
const TEXT_LETTER_SPACING_MAX = 2;

export type TextDialogNumericValues = {
  readonly sizeMm: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly bendDeg: number;
};

export function initialTextSizeMm(value: number): number {
  return clampFiniteNumber(value, DEFAULT_TEXT_SIZE_MM, TEXT_SIZE_MIN_MM, TEXT_SIZE_MAX_MM);
}

export function initialTextLineHeight(value: number): number {
  return clampFiniteNumber(
    value,
    DEFAULT_TEXT_LINE_HEIGHT,
    TEXT_LINE_HEIGHT_MIN,
    TEXT_LINE_HEIGHT_MAX,
  );
}

export function initialTextLetterSpacing(value: number): number {
  return clampFiniteNumber(
    value,
    DEFAULT_TEXT_LETTER_SPACING,
    TEXT_LETTER_SPACING_MIN,
    TEXT_LETTER_SPACING_MAX,
  );
}

export function initialTextBend(value: number): number {
  return clampBend(value);
}

export function sanitizeTextDialogNumericValues<T extends TextDialogNumericValues>(values: T): T {
  return {
    ...values,
    sizeMm: initialTextSizeMm(values.sizeMm),
    lineHeight: initialTextLineHeight(values.lineHeight),
    letterSpacing: initialTextLetterSpacing(values.letterSpacing),
    bendDeg: initialTextBend(values.bendDeg),
  };
}

export function TextDialogNumericFields(props: {
  readonly values: TextDialogNumericValues;
  readonly setSizeMm: (v: number) => void;
  readonly setLineHeight: (v: number) => void;
  readonly setLetterSpacing: (v: number) => void;
  readonly setBendDeg: (v: number) => void;
}): JSX.Element {
  const { values } = props;
  return (
    <>
      <Field label="Size">
        <NumberField
          ariaLabel="Text size"
          value={values.sizeMm}
          min={TEXT_SIZE_MIN_MM}
          max={TEXT_SIZE_MAX_MM}
          step={1}
          onCommit={props.setSizeMm}
          style={numStyle}
          title="Text height in millimeters."
          debounceMs={0}
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Line height">
        <NumberField
          ariaLabel="Text line height"
          value={values.lineHeight}
          min={TEXT_LINE_HEIGHT_MIN}
          max={TEXT_LINE_HEIGHT_MAX}
          step={0.1}
          onCommit={props.setLineHeight}
          style={numStyle}
          title="Vertical distance between text lines, relative to text size."
          debounceMs={0}
        />
        <span className="lf-field-unit">x size</span>
      </Field>
      <Field label="Spacing">
        <NumberField
          ariaLabel="Text letter spacing"
          value={values.letterSpacing}
          min={TEXT_LETTER_SPACING_MIN}
          max={TEXT_LETTER_SPACING_MAX}
          step={0.05}
          onCommit={props.setLetterSpacing}
          style={numStyle}
          title="Letter spacing (tracking). 0 = font's natural spacing. Positive widens, negative tightens."
          debounceMs={0}
        />
        <span className="lf-field-unit">x size (0 = natural)</span>
      </Field>
      <Field label="Bend">
        <NumberField
          ariaLabel="Text bend"
          value={values.bendDeg}
          min={TEXT_BEND_MIN_DEG}
          max={TEXT_BEND_MAX_DEG}
          step={5}
          onCommit={props.setBendDeg}
          style={numStyle}
          title="Bend text along a circular arc. Negative bends upward; positive bends downward."
          debounceMs={0}
        />
        <span className="lf-field-unit">deg</span>
      </Field>
    </>
  );
}

function clampFiniteNumber(value: number, fallback: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, finite));
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

const fieldAlignStyle: React.CSSProperties = { alignItems: 'flex-start' };
const fieldLabelPadStyle: React.CSSProperties = { paddingTop: 4 };
const fieldControlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};
const numStyle: React.CSSProperties = { width: 80 };
