import { DraftNumberInput } from '../kit/DraftNumberInput';

export function CutSettingsFillDensityFields(props: {
  readonly lineIntervalMm: number;
  readonly onChange: (lineIntervalMm: number) => void;
}): JSX.Element {
  return (
    <>
      <input
        type="hidden"
        name="hatchSpacingMm"
        value={props.lineIntervalMm}
        readOnly
        title="Hidden synchronized fill line interval value used when saving cut settings."
      />
      <Field label="Line Interval">
        <DraftNumberInput
          data-setting="hatchSpacingMm"
          min={0.05}
          max={10}
          step="any"
          className="lf-input"
          value={props.lineIntervalMm}
          format={(value) => String(displayNumber(value, 4))}
          normalize={clampFillLineInterval}
          onValueChange={props.onChange}
          style={numberStyle}
          aria-label="Cut settings line interval"
          title="Distance between fill scan lines. Smaller values engrave denser fills."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Lines / Inch">
        <DraftNumberInput
          data-setting="hatchSpacingMm"
          min={lineIntervalMmToLinesPerInch(10)}
          max={lineIntervalMmToLinesPerInch(0.05)}
          step="any"
          className="lf-input"
          value={lineIntervalMmToLinesPerInch(props.lineIntervalMm)}
          format={(value) => String(displayNumber(value, 2))}
          normalize={(value) => lineIntervalMmToLinesPerInch(linesPerInchToLineIntervalMm(value))}
          onValueChange={(value) => props.onChange(linesPerInchToLineIntervalMm(value))}
          style={numberStyle}
          aria-label="Cut settings lines per inch"
          title="Fill scan density in lines per inch. Higher values engrave denser fills."
        />
        <span className="lf-field-unit">lpi</span>
      </Field>
    </>
  );
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--md">{props.label}</span>
      <span style={controlStyle}>{props.children}</span>
    </label>
  );
}

function lineIntervalMmToLinesPerInch(lineIntervalMm: number): number {
  return 25.4 / Math.max(0.05, lineIntervalMm);
}

function linesPerInchToLineIntervalMm(linesPerInch: number): number {
  return clampFillLineInterval(25.4 / Math.max(lineIntervalMmToLinesPerInch(10), linesPerInch));
}

function clampFillLineInterval(lineIntervalMm: number): number {
  return Math.max(0.05, Math.min(10, lineIntervalMm));
}

function displayNumber(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
