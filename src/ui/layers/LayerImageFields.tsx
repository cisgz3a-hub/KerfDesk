import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster/raster-units';
import { DITHER_ALGORITHMS, type Layer, type LayerOperationSettings } from '../../core/scene';
import { useDebouncedCommit } from './use-debounced-commit';

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
};

const fieldLabelStyle: React.CSSProperties = {
  width: 96,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};

const fieldValueStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 1,
};

const inputStyle: React.CSSProperties = { width: 70, padding: '2px 6px' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
const ditherSelectStyle: React.CSSProperties = { flex: 1, maxWidth: 180 };

export function LayerImageFields(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  return (
    <>
      <FieldRow label="Dither">
        <DitherSelect layer={layer} settings={settings} commit={commit} />
      </FieldRow>
      {settings.ditherAlgorithm === 'grayscale' ? (
        <FieldRow label="Min Power">
          <MinPowerInput layer={layer} settings={settings} commit={commit} />
          <span style={unitStyle}>%</span>
        </FieldRow>
      ) : null}
      <FieldRow label="Line Interval">
        <LineIntervalInput layer={layer} settings={settings} commit={commit} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="DPI">
        <DpiInput layer={layer} settings={settings} commit={commit} />
        <span style={unitStyle}>dpi</span>
      </FieldRow>
      <FieldRow label="Dot Width">
        <DotWidthCorrectionInput layer={layer} settings={settings} commit={commit} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="Negative">
        <NegativeImageCheckbox layer={layer} settings={settings} commit={commit} />
      </FieldRow>
      <FieldRow label="Bidirectional">
        <BidirectionalImageCheckbox layer={layer} settings={settings} commit={commit} />
      </FieldRow>
      <FieldRow label="Pass-through">
        <PassThroughCheckbox layer={layer} settings={settings} commit={commit} />
      </FieldRow>
    </>
  );
}

function FieldRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{props.label}</span>
      <div style={fieldValueStyle}>{props.children}</div>
    </div>
  );
}

function DitherSelect(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  return (
    <select
      value={settings.ditherAlgorithm}
      onChange={(e) =>
        commit({
          ditherAlgorithm: e.target.value as Layer['ditherAlgorithm'],
        })
      }
      title="Binary modes emit off/max dots. Grayscale maps luma between Min Power and Power."
      aria-label={`Dither for ${layer.color}`}
      style={ditherSelectStyle}
    >
      {DITHER_ALGORITHMS.map((algorithm) => (
        <option key={algorithm} value={algorithm}>
          {DITHER_LABELS[algorithm]}
        </option>
      ))}
    </select>
  );
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

function LineIntervalInput(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  const debounced = useDebouncedCommit<number>({
    value: displayNumber(linesPerMmToLineIntervalMm(settings.linesPerMm), 4),
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
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Line interval for ${layer.color}`}
      title="Distance between raster scan lines for this image layer."
    />
  );
}

function DpiInput(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  const debounced = useDebouncedCommit<number>({
    value: displayNumber(linesPerMmToDpi(settings.linesPerMm), 2),
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
      step={1}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`DPI for ${layer.color}`}
      title="Raster engraving resolution for this image layer."
    />
  );
}

function MinPowerInput(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  const debounced = useDebouncedCommit<number>({
    value: settings.minPower,
    commit: (minPower) => commit({ minPower }),
    parse: (s) => clamp(numericValue(s, settings.minPower), 0, settings.power),
  });
  return (
    <input
      type="number"
      min={0}
      max={layer.power}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Minimum power for ${layer.color}`}
      title="Lowest laser power used by grayscale image engraving on this layer."
    />
  );
}

function DotWidthCorrectionInput(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  const max = dotWidthCorrectionMax(settings);
  const debounced = useDebouncedCommit<number>({
    value: settings.dotWidthCorrectionMm,
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
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Dot width correction for ${layer.color}`}
      title="Compensate for physical laser dot width when raster engraving this layer."
    />
  );
}

function NegativeImageCheckbox(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  return (
    <input
      type="checkbox"
      checked={settings.negativeImage}
      onChange={(event) => commit({ negativeImage: event.target.checked })}
      aria-label={`Negative image for ${layer.color}`}
      title="Invert image brightness before engraving this layer."
    />
  );
}

function BidirectionalImageCheckbox(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  return (
    <input
      type="checkbox"
      checked={settings.imageBidirectional}
      onChange={(event) => commit({ imageBidirectional: event.target.checked })}
      aria-label={`Bidirectional image scan for ${layer.color}`}
      title="Alternate raster rows in both directions. Turn off while diagnosing scan-offset drift."
    />
  );
}

function PassThroughCheckbox(props: {
  readonly layer: Layer;
  readonly settings: LayerOperationSettings;
  readonly commit: (patch: Partial<LayerOperationSettings>) => void;
}): JSX.Element {
  const { layer, settings, commit } = props;
  return (
    <input
      type="checkbox"
      checked={settings.passThrough}
      onChange={(event) => commit({ passThrough: event.target.checked })}
      aria-label={`Pass-through image for ${layer.color}`}
      title="Use image pixels as-is and skip LaserForge image adjustment for this layer."
    />
  );
}

function numericValue(s: string, fallback: number): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dotWidthCorrectionMax(settings: LayerOperationSettings): number {
  return 1 / Math.max(1, settings.linesPerMm);
}

function displayNumber(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}
