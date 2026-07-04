import {
  DEFAULT_TEXT_LETTER_SPACING,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE_MM,
} from '../../core/text';

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

export function sanitizeTextDialogNumericValues<T extends TextDialogNumericValues>(values: T): T {
  return {
    ...values,
    sizeMm: initialTextSizeMm(values.sizeMm),
    lineHeight: initialTextLineHeight(values.lineHeight),
    letterSpacing: initialTextLetterSpacing(values.letterSpacing),
  };
}

export function TextDialogNumericFields(props: {
  readonly values: TextDialogNumericValues;
  readonly setSizeMm: (v: number) => void;
  readonly setLineHeight: (v: number) => void;
  readonly setLetterSpacing: (v: number) => void;
}): JSX.Element {
  const { values } = props;
  return (
    <>
      <Field label="Size">
        <input
          type="number"
          min={TEXT_SIZE_MIN_MM}
          max={TEXT_SIZE_MAX_MM}
          step={1}
          value={values.sizeMm}
          onChange={(e) =>
            props.setSizeMm(
              parseNumberInput(e.target.value, values.sizeMm, TEXT_SIZE_MIN_MM, TEXT_SIZE_MAX_MM),
            )
          }
          className="lf-input"
          style={numStyle}
          aria-label="Text size"
          title="Text height in millimeters."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Line height">
        <input
          type="number"
          min={TEXT_LINE_HEIGHT_MIN}
          max={TEXT_LINE_HEIGHT_MAX}
          step={0.1}
          value={values.lineHeight}
          onChange={(e) =>
            props.setLineHeight(
              parseNumberInput(
                e.target.value,
                values.lineHeight,
                TEXT_LINE_HEIGHT_MIN,
                TEXT_LINE_HEIGHT_MAX,
              ),
            )
          }
          className="lf-input"
          style={numStyle}
          aria-label="Text line height"
          title="Vertical distance between text lines, relative to text size."
        />
        <span className="lf-field-unit">x size</span>
      </Field>
      <Field label="Spacing">
        <input
          type="number"
          min={TEXT_LETTER_SPACING_MIN}
          max={TEXT_LETTER_SPACING_MAX}
          step={0.05}
          value={values.letterSpacing}
          onChange={(e) =>
            props.setLetterSpacing(
              parseNumberInput(
                e.target.value,
                values.letterSpacing,
                TEXT_LETTER_SPACING_MIN,
                TEXT_LETTER_SPACING_MAX,
              ),
            )
          }
          className="lf-input"
          style={numStyle}
          aria-label="Text letter spacing"
          title="Letter spacing (tracking). 0 = font's natural spacing. Positive widens, negative tightens."
        />
        <span className="lf-field-unit">x size (0 = natural)</span>
      </Field>
    </>
  );
}

function parseNumberInput(value: string, fallback: number, min: number, max: number): number {
  return clampFiniteNumber(Number(value), fallback, min, max);
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
