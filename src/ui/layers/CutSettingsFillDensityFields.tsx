export function CutSettingsFillDensityFields(props: {
  readonly lineIntervalMm: number;
  readonly onChange: (lineIntervalMm: number) => void;
}): JSX.Element {
  return (
    <>
      <input
        type="hidden"
        name="hatchSpacingMm"
        value={displayNumber(props.lineIntervalMm, 4)}
        readOnly
        title="Hidden synchronized fill line interval value used when saving cut settings."
      />
      <Field label="Line Interval">
        <input
          type="number"
          min={0.05}
          max={10}
          step={0.001}
          className="lf-input"
          value={displayNumber(props.lineIntervalMm, 4)}
          onChange={(event) =>
            props.onChange(
              clampFillLineInterval(numericValue(event.target.value, props.lineIntervalMm)),
            )
          }
          style={numberStyle}
          aria-label="Cut settings line interval"
          title="Distance between fill scan lines. Smaller values engrave denser fills."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Lines / Inch">
        <input
          type="number"
          min={lineIntervalMmToLinesPerInch(10)}
          max={lineIntervalMmToLinesPerInch(0.05)}
          step={0.01}
          className="lf-input"
          value={displayNumber(lineIntervalMmToLinesPerInch(props.lineIntervalMm), 2)}
          onChange={(event) =>
            props.onChange(
              linesPerInchToLineIntervalMm(
                numericValue(
                  event.target.value,
                  lineIntervalMmToLinesPerInch(props.lineIntervalMm),
                ),
              ),
            )
          }
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

function numericValue(s: string, fallback: number): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
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
