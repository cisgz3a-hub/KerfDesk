import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MAX_RASTER_LINES_PER_MM,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster';
import { DITHER_ALGORITHMS, type Layer } from '../../core/scene';
import { dotWidthCorrectionMax } from './cut-settings-draft';

export function CutSettingsImageFields(props: {
  readonly layer: Layer;
  readonly dither: Layer['ditherAlgorithm'];
  readonly imageLinesPerMm: number;
  readonly onDitherChange: (dither: Layer['ditherAlgorithm']) => void;
  readonly onImageLinesPerMmChange: (linesPerMm: number) => void;
}): JSX.Element {
  return (
    <fieldset className="lf-fieldset">
      <legend className="lf-legend">Image</legend>
      <Field label="Dither">
        <select
          name="ditherAlgorithm"
          className="lf-select"
          value={props.dither}
          onChange={(event) => props.onDitherChange(parseDither(event.target.value))}
          aria-label="Cut settings dither"
          title="Choose how image brightness is converted into laser dots or grayscale power."
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
          <span className="lf-field-unit">%</span>
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
        <span className="lf-field-unit">mm</span>
      </Field>
      <ImageCheckboxField
        label="Negative"
        name="negativeImage"
        checked={props.layer.negativeImage}
        title="Invert image brightness before engraving this layer."
      />
      <ImageCheckboxField
        label="Bidirectional"
        name="imageBidirectional"
        checked={props.layer.imageBidirectional}
        title="Alternate raster rows in both directions. Turn off for scan-offset diagnosis."
      />
      <ImageCheckboxField
        label="Expert override"
        name="allowUncalibratedBidirectionalScan"
        checked={props.layer.allowUncalibratedBidirectionalScan === true}
        title="Allow bidirectional scanning without a scan-offset calibration. This can double or blur edges on the 4040."
      />
      <ImageCheckboxField
        label="Pass-through"
        name="passThrough"
        checked={props.layer.passThrough}
        title="Use the image pixels as-is and skip KerfDesk image processing."
      />
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
          className="lf-input"
          value={displayNumber(linesPerMmToLineIntervalMm(props.linesPerMm), 4)}
          onChange={(event) =>
            props.onChange(
              lineIntervalMmToLinesPerMm(
                numericValue(event.target.value, linesPerMmToLineIntervalMm(props.linesPerMm)),
              ),
            )
          }
          style={numberStyle}
          aria-label="Cut settings line interval"
          title="Distance between raster scan lines. Smaller values engrave denser images."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="DPI">
        <input
          name="imageDpi"
          type="number"
          min={linesPerMmToDpi(MIN_RASTER_LINES_PER_MM)}
          max={linesPerMmToDpi(MAX_RASTER_LINES_PER_MM)}
          step={0.01}
          className="lf-input"
          value={displayNumber(linesPerMmToDpi(props.linesPerMm), 2)}
          onChange={(event) =>
            props.onChange(
              dpiToLinesPerMm(numericValue(event.target.value, linesPerMmToDpi(props.linesPerMm))),
            )
          }
          style={numberStyle}
          aria-label="Cut settings DPI"
          title="Image engraving resolution in dots per inch. Higher values create more scan lines."
        />
        <span className="lf-field-unit">dpi</span>
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
      className="lf-input"
      min={props.min}
      {...(props.max !== undefined ? { max: props.max } : {})}
      step={props.step ?? 1}
      defaultValue={props.value}
      style={numberStyle}
      aria-label={`Cut settings ${props.label ?? props.name}`}
      title={`Set image cut setting ${props.label ?? props.name}.`}
    />
  );
}

function ImageCheckboxField(props: {
  readonly label: string;
  readonly name: string;
  readonly checked: boolean;
  readonly title: string;
}): JSX.Element {
  return (
    <Field label={props.label}>
      <input
        name={props.name}
        type="checkbox"
        className="lf-checkbox"
        defaultChecked={props.checked}
        title={props.title}
      />
    </Field>
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

function numericValue(s: string, fallback: number): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function displayNumber(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

const controlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const numberStyle: React.CSSProperties = { width: 88 };
