import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MAX_RASTER_LINES_PER_MM,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster';
import type { Layer, LayerOperationSettings } from '../../core/scene';
import { burnsAsGrayscale, DitherSwatchPicker, originalPixelsNotice } from './DitherSwatchPicker';
import { mixedCheckboxProps, useMixedOperationNumber } from './mixed-operation-input';
import type { MixedOperationFields } from './selected-operation-mixed';
import { clamp } from '../../core/math/clamp';
import { roundToDecimals } from '../../core/util/rounding';

const inputStyle: React.CSSProperties = { width: 88, minWidth: 0 };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };

export function LayerImageFields(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
  readonly labelContext?: string;
  readonly minPowerMax?: number;
}): JSX.Element {
  const { layer, settings, commit } = props;
  const labelContext = props.labelContext ?? layer.color;
  const minPowerMax = props.mixedFields?.power ? 100 : (props.minPowerMax ?? layer.power);
  const controlProps = {
    labelContext,
    settings,
    commit,
    reconcileKey: props.reconcileKey,
    ...(props.mixedFields === undefined ? {} : { mixedFields: props.mixedFields }),
  };
  return (
    <>
      <p className="lf-laser-help">
        Dither creates a pattern of dots. Grayscale varies the laser power with image brightness.
      </p>
      <div className="lf-laser-field lf-laser-field--stacked">
        <span className="lf-laser-field__label">Dither</span>
        <div className="lf-laser-field__value">
          <DitherSelect {...controlProps} />
        </div>
      </div>
      {minPowerApplies(settings, props.mixedFields) ? (
        <FieldRow label="Minimum power">
          <MinPowerInput {...controlProps} maxPower={minPowerMax} />
          <span style={unitStyle}>%</span>
        </FieldRow>
      ) : null}
      <FieldRow label="Line interval">
        <LineIntervalInput {...controlProps} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="DPI">
        <DpiInput {...controlProps} />
        <span style={unitStyle}>dpi</span>
      </FieldRow>
      <p className="lf-laser-help">
        Line interval and DPI describe the same scan density. Changing one updates the other. A
        smaller line interval (higher DPI) burns more energy per area at the same power and speed,
        so lower power or raise speed when you tighten it.
      </p>
      <FieldRow label="Dot width">
        <DotWidthCorrectionInput {...controlProps} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="Invert brightness">
        <NegativeImageCheckbox {...controlProps} />
      </FieldRow>
      <FieldRow label="Use original pixels">
        <PassThroughCheckbox {...controlProps} />
      </FieldRow>
    </>
  );
}

// The inspector's image essentials (ADR-430): the dither and the scan density,
// plus Minimum power when grayscale maps brightness to power. DPI, dot width,
// invert and original pixels stay in Cut Settings.
export function LayerImageEssentials(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
  readonly labelContext: string;
}): JSX.Element {
  const { layer, settings, commit } = props;
  const controlProps = {
    labelContext: props.labelContext,
    settings,
    commit,
    reconcileKey: props.reconcileKey,
    ...(props.mixedFields === undefined ? {} : { mixedFields: props.mixedFields }),
  };
  const grayscale = minPowerApplies(settings, props.mixedFields);
  return (
    <div className="lf-laser-process-fields">
      <div className="lf-laser-field lf-laser-field--wide">
        <span className="lf-laser-field__label">Dither</span>
        <div className="lf-laser-field__value">
          <DitherSelect {...controlProps} />
        </div>
      </div>
      <label className="lf-laser-field">
        <span className="lf-laser-field__label">
          Line interval<small>mm</small>
        </span>
        <span className="lf-laser-field__value">
          <LineIntervalInput {...controlProps} />
        </span>
      </label>
      {grayscale ? (
        <label className="lf-laser-field">
          <span className="lf-laser-field__label">
            Min power<small>%</small>
          </span>
          <span className="lf-laser-field__value">
            <MinPowerInput
              {...controlProps}
              maxPower={props.mixedFields?.power ? 100 : layer.power}
            />
          </span>
        </label>
      ) : null}
    </div>
  );
}

// Min power shows whenever the burn is Grayscale, including original pixels
// over a binary dither (burnsAsGrayscale); a Mixed setting counts as unknown.
function minPowerApplies(
  settings: LayerOperationSettings,
  mixed: MixedOperationFields | undefined,
): boolean {
  return burnsAsGrayscale(
    mixed?.passThrough ? null : settings.passThrough,
    mixed?.ditherAlgorithm ? null : settings.ditherAlgorithm,
  );
}

function FieldRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="lf-laser-field">
      <span className="lf-laser-field__label">{props.label}</span>
      <span className="lf-laser-field__value">{props.children}</span>
    </label>
  );
}

// Its row is a div, not a label: a label would hand a click on "Dither" to the
// first swatch.
function DitherSelect(props: {
  readonly labelContext: string;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { labelContext, settings, commit } = props;
  const notice = passThroughNotice(settings, props.mixedFields);
  return (
    <DitherSwatchPicker
      value={props.mixedFields?.ditherAlgorithm ? null : settings.ditherAlgorithm}
      onChange={(ditherAlgorithm) => commit({ ditherAlgorithm })}
      title="Binary modes emit off/max dots. Grayscale maps luma between Min Power and Power."
      ariaLabel={`Dither for ${labelContext}`}
      {...(notice === undefined ? {} : { notice })}
    />
  );
}

// Use original pixels burns the image's own pixels as Grayscale whatever the
// stored dither (imageDitherAlgorithm), so say so rather than let a swatch
// promise dots that will not burn.
function passThroughNotice(
  settings: LayerOperationSettings,
  mixed: MixedOperationFields | undefined,
): string | undefined {
  if (mixed?.passThrough) {
    return 'Some selected artwork uses original pixels, which always burns as Grayscale.';
  }
  const chosen = mixed?.ditherAlgorithm ? null : settings.ditherAlgorithm;
  return originalPixelsNotice('Use original pixels', settings.passThrough, chosen);
}

function LineIntervalInput(props: {
  readonly labelContext: string;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { labelContext, settings, commit } = props;
  const debounced = useMixedOperationNumber({
    value: roundToDecimals(linesPerMmToLineIntervalMm(settings.linesPerMm), 4),
    mixed: props.mixedFields?.linesPerMm,
    reconcileKey: props.reconcileKey,
    commit: (lineIntervalMm) => commit({ linesPerMm: lineIntervalMmToLinesPerMm(lineIntervalMm) }),
    parse: (s) =>
      clamp(
        numericValue(s, linesPerMmToLineIntervalMm(settings.linesPerMm)),
        linesPerMmToLineIntervalMm(MAX_RASTER_LINES_PER_MM),
        linesPerMmToLineIntervalMm(MIN_RASTER_LINES_PER_MM),
      ),
  });
  return (
    <input
      type="number"
      min={linesPerMmToLineIntervalMm(MAX_RASTER_LINES_PER_MM)}
      max={linesPerMmToLineIntervalMm(MIN_RASTER_LINES_PER_MM)}
      step={0.001}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Line interval for ${labelContext}`}
      title="Distance between raster scan lines for this image layer."
    />
  );
}

function DpiInput(props: {
  readonly labelContext: string;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { labelContext, settings, commit } = props;
  const debounced = useMixedOperationNumber({
    value: roundToDecimals(linesPerMmToDpi(settings.linesPerMm), 2),
    mixed: props.mixedFields?.linesPerMm,
    reconcileKey: props.reconcileKey,
    commit: (dpi) => commit({ linesPerMm: dpiToLinesPerMm(dpi) }),
    parse: (s) =>
      clamp(
        numericValue(s, linesPerMmToDpi(settings.linesPerMm)),
        linesPerMmToDpi(MIN_RASTER_LINES_PER_MM),
        linesPerMmToDpi(MAX_RASTER_LINES_PER_MM),
      ),
  });
  return (
    <input
      type="number"
      min={linesPerMmToDpi(MIN_RASTER_LINES_PER_MM)}
      max={linesPerMmToDpi(MAX_RASTER_LINES_PER_MM)}
      step={0.01}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`DPI for ${labelContext}`}
      title="Raster engraving resolution for this image layer."
    />
  );
}

function MinPowerInput(props: {
  readonly labelContext: string;
  readonly maxPower: number;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { labelContext, maxPower, settings, commit } = props;
  const debounced = useMixedOperationNumber({
    value: settings.minPower,
    mixed: props.mixedFields?.minPower,
    reconcileKey: props.reconcileKey,
    commit: (minPower) => commit({ minPower }),
    parse: (s) => clamp(numericValue(s, settings.minPower), 0, maxPower),
  });
  return (
    <input
      type="number"
      min={0}
      max={maxPower}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Minimum power for ${labelContext}`}
      title="Lowest laser power used by grayscale image engraving on this layer."
    />
  );
}

function DotWidthCorrectionInput(props: {
  readonly labelContext: string;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { labelContext, settings, commit } = props;
  const max = props.mixedFields?.linesPerMm ? 1 : dotWidthCorrectionMax(settings);
  const debounced = useMixedOperationNumber({
    value: settings.dotWidthCorrectionMm,
    mixed: props.mixedFields?.dotWidthCorrectionMm,
    reconcileKey: props.reconcileKey,
    commit: (dotWidthCorrectionMm) => commit({ dotWidthCorrectionMm }),
    parse: (s) => clamp(numericValue(s, settings.dotWidthCorrectionMm), 0, max),
  });
  return (
    <input
      type="number"
      min={0}
      max={max}
      step={0.001}
      value={debounced.displayValue}
      {...debounced.inputProps}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Dot width correction for ${labelContext}`}
      title="Compensate for physical laser dot width when raster engraving this layer. Shortens each burned line at both ends, where the beam turns on and off along the scan; power changes inside a line are not trimmed. It cannot widen white lines that run parallel to the scan."
    />
  );
}

function NegativeImageCheckbox(props: {
  readonly labelContext: string;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { labelContext, settings, commit } = props;
  return (
    <input
      type="checkbox"
      {...mixedCheckboxProps(settings.negativeImage, props.mixedFields?.negativeImage)}
      onChange={(event) => commit({ negativeImage: event.target.checked })}
      aria-label={`Negative image for ${labelContext}`}
      title="Invert image brightness before engraving this layer."
    />
  );
}

function PassThroughCheckbox(props: {
  readonly labelContext: string;
  readonly settings: LayerOperationSettings;
  readonly mixedFields?: MixedOperationFields;
  readonly reconcileKey?: unknown;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { labelContext, settings, commit } = props;
  return (
    <input
      type="checkbox"
      {...mixedCheckboxProps(settings.passThrough, props.mixedFields?.passThrough)}
      onChange={(event) => commit({ passThrough: event.target.checked })}
      aria-label={`Pass-through image for ${labelContext}`}
      title="Use image pixels as-is and skip KerfDesk image adjustment for this layer."
    />
  );
}

function numericValue(s: string, fallback: number): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function dotWidthCorrectionMax(settings: LayerOperationSettings): number {
  return 1 / Math.max(1, settings.linesPerMm);
}
