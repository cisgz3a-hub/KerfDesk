import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster/raster-units';
import { DITHER_ALGORITHMS, type Layer } from '../../core/scene';
import { useStore } from '../state';
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

export function LayerImageFields({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <>
      <FieldRow label="Dither">
        <DitherSelect layer={layer} />
      </FieldRow>
      {layer.ditherAlgorithm === 'grayscale' ? (
        <FieldRow label="Min Power">
          <MinPowerInput layer={layer} />
          <span style={unitStyle}>%</span>
        </FieldRow>
      ) : null}
      <FieldRow label="Line Interval">
        <LineIntervalInput layer={layer} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="DPI">
        <DpiInput layer={layer} />
        <span style={unitStyle}>dpi</span>
      </FieldRow>
      <FieldRow label="Dot Width">
        <DotWidthCorrectionInput layer={layer} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="Negative">
        <NegativeImageCheckbox layer={layer} />
      </FieldRow>
      <FieldRow label="Bidirectional">
        <BidirectionalImageCheckbox layer={layer} />
      </FieldRow>
      <FieldRow label="Pass-through">
        <PassThroughCheckbox layer={layer} />
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

function DitherSelect({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <select
      value={layer.ditherAlgorithm}
      onChange={(e) =>
        setLayerParam(layer.id, {
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

function LineIntervalInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: displayNumber(linesPerMmToLineIntervalMm(layer.linesPerMm), 4),
    commit: (lineIntervalMm) =>
      setLayerParam(layer.id, { linesPerMm: lineIntervalMmToLinesPerMm(lineIntervalMm) }),
    parse: (s) =>
      clamp(
        numericValue(s, linesPerMmToLineIntervalMm(layer.linesPerMm)),
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

function DpiInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: displayNumber(linesPerMmToDpi(layer.linesPerMm), 2),
    commit: (dpi) => setLayerParam(layer.id, { linesPerMm: dpiToLinesPerMm(dpi) }),
    parse: (s) =>
      clamp(
        numericValue(s, linesPerMmToDpi(layer.linesPerMm)),
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

function MinPowerInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.minPower,
    commit: (minPower) => setLayerParam(layer.id, { minPower }),
    parse: (s) => clamp(numericValue(s, layer.minPower), 0, layer.power),
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

function DotWidthCorrectionInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const max = dotWidthCorrectionMax(layer);
  const debounced = useDebouncedCommit<number>({
    value: layer.dotWidthCorrectionMm,
    commit: (dotWidthCorrectionMm) => setLayerParam(layer.id, { dotWidthCorrectionMm }),
    parse: (s) => clamp(numericValue(s, layer.dotWidthCorrectionMm), 0, max),
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

function NegativeImageCheckbox({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <input
      type="checkbox"
      checked={layer.negativeImage}
      onChange={(event) => setLayerParam(layer.id, { negativeImage: event.target.checked })}
      aria-label={`Negative image for ${layer.color}`}
      title="Invert image brightness before engraving this layer."
    />
  );
}

function BidirectionalImageCheckbox({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <input
      type="checkbox"
      checked={layer.imageBidirectional}
      onChange={(event) => setLayerParam(layer.id, { imageBidirectional: event.target.checked })}
      aria-label={`Bidirectional image scan for ${layer.color}`}
      title="Alternate raster rows in both directions. Turn off while diagnosing scan-offset drift."
    />
  );
}

function PassThroughCheckbox({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <input
      type="checkbox"
      checked={layer.passThrough}
      onChange={(event) => setLayerParam(layer.id, { passThrough: event.target.checked })}
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

function dotWidthCorrectionMax(layer: Layer): number {
  return 1 / Math.max(1, layer.linesPerMm);
}

function displayNumber(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}
