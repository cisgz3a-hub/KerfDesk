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
      />
      <Field label="Line Interval">
        <input
          type="number"
          min={0.05}
          max={10}
          step={0.001}
          value={displayNumber(props.lineIntervalMm, 4)}
          onChange={(event) =>
            props.onChange(clampFillLineInterval(numericValue(event.target.value)))
          }
          style={numberStyle}
          aria-label="Cut settings line interval"
        />
        <span style={unitStyle}>mm</span>
      </Field>
      <Field label="Lines / Inch">
        <input
          type="number"
          min={lineIntervalMmToLinesPerInch(10)}
          max={lineIntervalMmToLinesPerInch(0.05)}
          step={1}
          value={displayNumber(lineIntervalMmToLinesPerInch(props.lineIntervalMm), 2)}
          onChange={(event) =>
            props.onChange(linesPerInchToLineIntervalMm(numericValue(event.target.value)))
          }
          style={numberStyle}
          aria-label="Cut settings lines per inch"
        />
        <span style={unitStyle}>lpi</span>
      </Field>
    </>
  );
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{props.label}</span>
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

function numericValue(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function displayNumber(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

const fieldStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const labelStyle: React.CSSProperties = { width: 112, color: '#444', fontSize: 13 };
const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
const unitStyle: React.CSSProperties = { color: '#666', fontSize: 12 };
