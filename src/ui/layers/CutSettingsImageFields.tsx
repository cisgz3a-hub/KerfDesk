import { useEffect, useState } from 'react';
import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MAX_RASTER_LINES_PER_MM,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster';
import {
  accelerationDistanceMm,
  imageOverscanMmFor,
  MAX_IMAGE_OVERSCAN_MM,
} from '../../core/job/operation-cut-extras';
import { DITHER_ALGORITHMS, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { dotWidthCorrectionMax } from './cut-settings-draft';

export function CutSettingsImageFields(props: {
  readonly layer: Layer;
  readonly dither: Layer['ditherAlgorithm'];
  readonly imageLinesPerMm: number;
  readonly maxPower?: number;
  readonly deferArtworkBounds?: boolean;
  /** Material presets do not store image overscan (ADR-415), so their wizard hides it. */
  readonly showOverscan?: boolean;
  readonly onDitherChange: (dither: Layer['ditherAlgorithm']) => void;
  readonly onImageLinesPerMmChange: (linesPerMm: number) => void;
}): JSX.Element {
  const maxPower = props.deferArtworkBounds ? 100 : (props.maxPower ?? props.layer.power);
  return (
    <fieldset className="lf-fieldset lf-cut-settings-group">
      <legend className="lf-legend">Image detail</legend>
      <p className="lf-laser-help">
        Dither creates a pattern of dots. Grayscale varies the laser power with image brightness.
      </p>
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
          <MinPowerInput initialValue={props.layer.minPower} maxPower={maxPower} />
          <span className="lf-field-unit">%</span>
        </Field>
      ) : null}
      <ImageDensityFields
        linesPerMm={props.imageLinesPerMm}
        onChange={props.onImageLinesPerMmChange}
      />
      <p className="lf-laser-help">
        Line interval and DPI describe the same scan density. Changing one updates the other. A
        smaller line interval (higher DPI) burns more energy per area at the same power and speed,
        so lower power or raise speed when you tighten it.
      </p>
      <Field label="Dot Width">
        <NumberInput
          name="dotWidthCorrectionMm"
          value={props.layer.dotWidthCorrectionMm}
          min={0}
          max={props.deferArtworkBounds ? 1 : dotWidthCorrectionMax(props.imageLinesPerMm)}
          step={0.001}
          label="dot width correction"
          title="Compensate for physical laser dot width when raster engraving. Shortens each burned run at both ends along the scan; it cannot widen white lines that run parallel to the scan."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      {props.showOverscan === true ? <ImageOverscanField layer={props.layer} /> : null}
      <ImageCheckboxField
        label="Invert brightness"
        name="negativeImage"
        checked={props.layer.negativeImage}
        title="Invert image brightness before engraving this layer."
      />
      <ImageCheckboxField
        label="Scan both ways"
        name="imageBidirectional"
        checked={props.layer.imageBidirectional}
        title="Alternate raster rows in both directions. Turn off for scan-offset diagnosis."
      />
      <ImageExtraFields layer={props.layer} />
    </fieldset>
  );
}

// ADR-415: per-operation overscan, with the run-up this machine actually needs
// to reach the operation's speed (v² / 2a from its acceleration setting).
function ImageOverscanField(props: { readonly layer: Layer }): JSX.Element {
  const device = useStore((state) => state.project.device);
  const feed = Math.min(props.layer.speed, device.maxFeed);
  const neededMm = accelerationDistanceMm(feed, device.accelMmPerSec2);
  return (
    <>
      <Field label="Overscan">
        <NumberInput
          name="imageOverscanMm"
          value={imageOverscanMmFor(props.layer)}
          min={0}
          max={MAX_IMAGE_OVERSCAN_MM}
          step={0.01}
          label="image overscan"
          title="Laser-off run-up added at both ends of every scan line so the head is at full speed before it burns. Too little darkens the image edges."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <p className="lf-laser-help">
        At the saved speed of {formatNumber(feed)} mm/min and {formatNumber(device.accelMmPerSec2)}{' '}
        mm/s² acceleration, the head needs about {formatNumber(neededMm)} mm to reach full speed.
        {neededMm > MAX_IMAGE_OVERSCAN_MM
          ? ` That is more than the ${MAX_IMAGE_OVERSCAN_MM} mm maximum, so lower the speed if the image edges burn darker.`
          : ''}
      </p>
    </>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function ImageExtraFields(props: { readonly layer: Layer }): JSX.Element {
  return (
    <details className="lf-cut-settings-disclosure">
      <summary title="Show original-pixel processing and scan-calibration options">
        Image &amp; calibration extras
      </summary>
      <div className="lf-cut-settings-disclosure__body">
        <ImageCheckboxField
          label="Allow uncalibrated scans"
          name="allowUncalibratedBidirectionalScan"
          checked={props.layer.allowUncalibratedBidirectionalScan === true}
          title="Allow uncalibrated bidirectional scanning, which can double or blur edges. Profiles requiring verified offsets still use one-way scanning while a saved table is marked pending."
        />
        <p className="lf-laser-help">
          Uncalibrated scans can produce doubled or blurred edges. Some profiles still use one-way
          scanning while calibration is pending.
        </p>
        <ImageCheckboxField
          label="Use original pixels"
          name="passThrough"
          checked={props.layer.passThrough}
          title="Use the image pixels as-is and skip KerfDesk image processing."
        />
        <p className="lf-laser-help">
          Pass-through keeps original pixels and density, skipping brightness, contrast, gamma,
          negative and dither adjustments. Power range, placement, masks and Dot Width still apply.
        </p>
      </div>
    </details>
  );
}

function MinPowerInput(props: {
  readonly initialValue: number;
  readonly maxPower: number;
}): JSX.Element {
  const [value, setValue] = useState(props.initialValue);
  useEffect(() => setValue((current) => Math.min(current, props.maxPower)), [props.maxPower]);
  return (
    <input
      name="minPower"
      type="number"
      className="lf-input"
      aria-label="Cut settings minPower"
      title="Set the minimum grayscale power."
      value={Math.min(value, props.maxPower)}
      min={0}
      max={props.maxPower}
      step="any"
      onChange={(event) => setValue(numericValue(event.target.value, 0))}
      style={numberStyle}
    />
  );
}

function ImageDensityFields(props: {
  readonly linesPerMm: number;
  readonly onChange: (linesPerMm: number) => void;
}): JSX.Element {
  return (
    <>
      <input
        type="hidden"
        name="linesPerMm"
        value={props.linesPerMm}
        readOnly
        title="Hidden synchronized image scan density used when saving cut settings."
      />
      <Field label="Line Interval">
        <input
          name="lineIntervalMm"
          type="number"
          min={linesPerMmToLineIntervalMm(MAX_RASTER_LINES_PER_MM)}
          max={linesPerMmToLineIntervalMm(MIN_RASTER_LINES_PER_MM)}
          step="any"
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
          title="Distance between raster scan lines. Smaller values pack rows closer and burn more energy per area at the same power and speed."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="DPI">
        <input
          name="imageDpi"
          type="number"
          min={linesPerMmToDpi(MIN_RASTER_LINES_PER_MM)}
          max={linesPerMmToDpi(MAX_RASTER_LINES_PER_MM)}
          step="any"
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
  readonly title?: string;
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
      title={props.title ?? `Set image cut setting ${props.label ?? props.name}.`}
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
