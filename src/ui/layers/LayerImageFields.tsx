import { MAX_RASTER_LINES_PER_MM } from '../../core/raster/raster-budget';
import type { Layer } from '../../core/scene';
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
  color: '#333',
};

const fieldValueStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 1,
};

const inputStyle: React.CSSProperties = { width: 70, padding: '2px 6px' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: '#666' };
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
      <FieldRow label="Resolution">
        <LinesPerMmInput layer={layer} />
        <span style={unitStyle}>lines / mm</span>
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
      <option value="threshold">Threshold</option>
      <option value="floyd-steinberg">Floyd-Steinberg</option>
      <option value="jarvis">Jarvis</option>
      <option value="stucki">Stucki</option>
      <option value="atkinson">Atkinson</option>
      <option value="burkes">Burkes</option>
      <option value="sierra3">Sierra 3</option>
      <option value="sierra2">Sierra 2</option>
      <option value="sierra-lite">Sierra Lite</option>
      <option value="ordered">Ordered</option>
      <option value="grayscale">Grayscale</option>
    </select>
  );
}

function LinesPerMmInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.linesPerMm,
    commit: (linesPerMm) => setLayerParam(layer.id, { linesPerMm }),
    // 5..25 lines/mm (WORKFLOW.md). The cap matches raster-budget so the
    // field can't author an obviously over-budget raster by itself.
    parse: (s) => clamp(numericValue(s), 5, MAX_RASTER_LINES_PER_MM),
  });
  return (
    <input
      type="number"
      min={5}
      max={MAX_RASTER_LINES_PER_MM}
      step={1}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Lines per mm for ${layer.color}`}
    />
  );
}

function MinPowerInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.minPower,
    commit: (minPower) => setLayerParam(layer.id, { minPower }),
    parse: (s) => clamp(numericValue(s), 0, layer.power),
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
    />
  );
}

function numericValue(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
