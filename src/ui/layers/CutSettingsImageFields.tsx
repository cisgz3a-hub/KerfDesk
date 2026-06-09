import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster/raster-units';
import { DITHER_ALGORITHMS, type Layer } from '../../core/scene';

export function CutSettingsImageFields(props: {
  readonly layer: Layer;
  readonly dither: Layer['ditherAlgorithm'];
  readonly imageLinesPerMm: number;
  readonly onDitherChange: (dither: Layer['ditherAlgorithm']) => void;
  readonly onImageLinesPerMmChange: (linesPerMm: number) => void;
}): JSX.Element {
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Image</legend>
      <Field label="Dither">
        <select
          name="ditherAlgorithm"
          value={props.dither}
          onChange={(event) => props.onDitherChange(parseDither(event.target.value))}
          aria-label="Cut settings dither"
        >
          {DITHER_ALGORITHMS.map((algorithm) => (
            <option key={algorithm} value={algorithm}>
              {DITHER_LABELS[algorithm]}
            </option>
          ))}
        </select>
      </Field>
      {props.dither === 'grayscale' ? (
        <Field label="Min Power">
          <NumberInput
            name="minPower"
            value={props.layer.minPower}
            min={0}
            max={props.layer.power}
          />
          <span style={unitStyle}>%</span>
        </Field>
      ) : null}
      <ImageDensityFields
        linesPerMm={props.imageLinesPerMm}
        onChange={props.onImageLinesPerMmChange}
      />
      <Field label="Dot Width">
        <NumberInput
          name="dotWidthCorrectionMm"
          value={props.layer.dotWidthCorrectionMm}
          min={0}
          max={dotWidthCorrectionMax(props.imageLinesPerMm)}
          step={0.001}
          label="dot width correction"
        />
        <span style={unitStyle}>mm</span>
      </Field>
      <Field label="Negative">
        <input name="negativeImage" type="checkbox" defaultChecked={props.layer.negativeImage} />
      </Field>
      <Field label="Pass-through">
        <input name="passThrough" type="checkbox" defaultChecked={props.layer.passThrough} />
      </Field>
    </fieldset>
  );
}

function ImageDensityFields(props: {
  readonly linesPerMm: number;
  readonly onChange: (linesPerMm: number) => void;
}): JSX.Element {
  return (
    <>
      <Field label="Line Interval">
        <input
          name="lineIntervalMm"
          type="number"
          min={linesPerMmToLineIntervalMm(MAX_RASTER_LINES_PER_MM)}
          max={linesPerMmToLineIntervalMm(MIN_RASTER_LINES_PER_MM)}
          step={0.001}
          value={displayNumber(linesPerMmToLineIntervalMm(props.linesPerMm), 4)}
          onChange={(event) =>
            props.onChange(lineIntervalMmToLinesPerMm(numericValue(event.target.value)))
          }
          style={numberStyle}
          aria-label="Cut settings line interval"
        />
        <span style={unitStyle}>mm</span>
      </Field>
      <Field label="DPI">
        <input
          name="imageDpi"
          type="number"
          min={linesPerMmToDpi(MIN_RASTER_LINES_PER_MM)}
          max={linesPerMmToDpi(MAX_RASTER_LINES_PER_MM)}
          step={1}
          value={displayNumber(linesPerMmToDpi(props.linesPerMm), 2)}
          onChange={(event) => props.onChange(dpiToLinesPerMm(numericValue(event.target.value)))}
          style={numberStyle}
          aria-label="Cut settings DPI"
        />
        <span style={unitStyle}>dpi</span>
      </Field>
    </>
  );
}

function NumberInput(props: {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max?: number;
  readonly step?: number;
  readonly label?: string;
}): JSX.Element {
  return (
    <input
      name={props.name}
      type="number"
      min={props.min}
      {...(props.max !== undefined ? { max: props.max } : {})}
      step={props.step ?? 1}
      defaultValue={props.value}
      style={numberStyle}
      aria-label={`Cut settings ${props.label ?? props.name}`}
    />
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

function parseDither(value: string): Layer['ditherAlgorithm'] {
  return DITHER_ALGORITHMS.some((algorithm) => algorithm === value)
    ? (value as Layer['ditherAlgorithm'])
    : 'floyd-steinberg';
}

const DITHER_LABELS: Readonly<Record<Layer['ditherAlgorithm'], string>> = {
  threshold: 'Threshold',
  'floyd-steinberg': 'Floyd-Steinberg',
  jarvis: 'Jarvis',
  stucki: 'Stucki',
  atkinson: 'Atkinson',
  burkes: 'Burkes',
  sierra3: 'Sierra 3',
  sierra2: 'Sierra 2',
  'sierra-lite': 'Sierra Lite',
  ordered: 'Ordered',
  grayscale: 'Grayscale',
};

function dotWidthCorrectionMax(linesPerMm: number): number {
  return 1 / Math.max(1, linesPerMm);
}

function numericValue(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function displayNumber(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 10,
  display: 'grid',
  gap: 8,
};
const legendStyle: React.CSSProperties = { padding: '0 4px', fontWeight: 600 };
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr',
  alignItems: 'center',
  gap: 8,
};
const labelStyle: React.CSSProperties = { color: '#333' };
const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const numberStyle: React.CSSProperties = { width: 88 };
const unitStyle: React.CSSProperties = { fontSize: 12, color: '#666' };
