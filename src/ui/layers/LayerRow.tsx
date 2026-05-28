// LayerRow — single row of the Cuts/Layers panel. Each input field is a thin
// sub-component so this component itself stays under the 80-line function
// limit and the JSX stays readable.
//
// Number inputs (power / speed / passes) use a 300ms debounced commit so
// typing "1500" doesn't push four undo frames (F-A7 — "the LF1 audit found
// this missing; do not repeat"). Visible / Output checkboxes commit
// immediately since each click is a single discrete change.

import type { Layer, LayerMode } from '../../core/scene';
import { useStore } from '../state';
import { useDebouncedCommit } from './use-debounced-commit';

const rowStyle: React.CSSProperties = {};
const rowDimmedStyle: React.CSSProperties = { opacity: 0.5 };
const tdStyle: React.CSSProperties = { padding: '4px 4px', verticalAlign: 'middle' };
const swatchStyle: React.CSSProperties = { display: 'inline-block', width: 12, height: 12 };
const inputStyle: React.CSSProperties = { width: 64 };
const unitStyle: React.CSSProperties = { fontSize: 11, color: '#666', marginLeft: 2 };
// F.1 fill sub-row: visually grouped under the parent layer row.
const subRowStyle: React.CSSProperties = { background: '#fafafa' };
const subRowLabelStyle: React.CSSProperties = {
  padding: '2px 4px 6px 4px',
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
};
const subRowLabelTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  width: 40,
};

export function LayerRow({ layer }: { readonly layer: Layer }): JSX.Element {
  // When the layer is in Fill mode we render an extra sub-row underneath
  // with the hatch angle + spacing inputs. Keeps the main row at its
  // existing 7-column shape so non-fill layers (the common case) don't
  // grow the panel width — and matches the LightBurn pattern of
  // mode-conditional sub-controls.
  return (
    <>
      <tr style={layer.output ? rowStyle : rowDimmedStyle}>
        <td style={tdStyle}>
          <ColorSwatch color={layer.color} visible={layer.visible} />
        </td>
        <td style={tdStyle}>
          <ModeSelect layer={layer} />
        </td>
        <td style={tdStyle}>
          <PowerInput layer={layer} />
        </td>
        <td style={tdStyle}>
          <SpeedInput layer={layer} />
        </td>
        <td style={tdStyle}>
          <PassesInput layer={layer} />
        </td>
        <td style={tdStyle}>
          <VisibleToggle layer={layer} />
        </td>
        <td style={tdStyle}>
          <OutputToggle layer={layer} />
        </td>
      </tr>
      {layer.mode === 'fill' && <FillSubRow layer={layer} />}
      {layer.mode === 'image' && <ImageSubRow layer={layer} />}
    </>
  );
}

function ColorSwatch(props: { readonly color: string; readonly visible: boolean }): JSX.Element {
  return (
    <span
      title={props.color}
      style={{
        ...swatchStyle,
        background: props.visible ? props.color : 'transparent',
        border: props.visible ? '1px solid #333' : '1px dashed #999',
      }}
    />
  );
}

function ModeSelect({ layer }: { readonly layer: Layer }): JSX.Element {
  // F.1 enables 'fill'; F.2 enables 'image' (raster engrave via
  // dither + per-pixel S modulation; needs a RasterImage on the
  // layer to actually emit G-code).
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <select
      value={layer.mode}
      onChange={(e) => setLayerParam(layer.id, { mode: e.target.value as LayerMode })}
      title="Line: cut along the outline. Fill: hatch a closed shape. Image: raster-engrave a bitmap."
      aria-label={`Mode for ${layer.color}`}
    >
      <option value="line">Line</option>
      <option value="fill">Fill</option>
      <option value="image">Image</option>
    </select>
  );
}

function FillSubRow({ layer }: { readonly layer: Layer }): JSX.Element {
  // Sub-row spans the full table width (7 cols) and shows only when the
  // layer is in Fill mode. Inputs commit on the same 300ms debounce as
  // the main-row power/speed/passes (consistent UX per F-A7).
  return (
    <tr style={layer.output ? subRowStyle : { ...subRowStyle, ...rowDimmedStyle }}>
      <td style={tdStyle} aria-hidden />
      <td style={subRowLabelStyle} colSpan={6}>
        <span style={subRowLabelTextStyle}>Hatch</span>
        <HatchAngleInput layer={layer} />
        <HatchSpacingInput layer={layer} />
      </td>
    </tr>
  );
}

function HatchAngleInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.hatchAngleDeg,
    commit: (hatchAngleDeg) => setLayerParam(layer.id, { hatchAngleDeg }),
    parse: (s) => clamp(numericValue(s), 0, 180),
  });
  return (
    <>
      <input
        type="number"
        min={0}
        max={180}
        step={5}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={`Hatch angle for ${layer.color}`}
      />
      <span style={unitStyle}>° angle</span>
    </>
  );
}

function HatchSpacingInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.hatchSpacingMm,
    commit: (hatchSpacingMm) => setLayerParam(layer.id, { hatchSpacingMm }),
    parse: (s) => clamp(numericValue(s), 0.05, 10),
  });
  return (
    <>
      <input
        type="number"
        min={0.05}
        max={10}
        step={0.05}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={`Hatch spacing for ${layer.color}`}
      />
      <span style={unitStyle}>mm spacing</span>
    </>
  );
}

// F.2.e: image-mode sub-row. Mirrors FillSubRow's layout — full
// width below the main row, two inputs (dither + lines/mm).
function ImageSubRow({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <tr style={layer.output ? subRowStyle : { ...subRowStyle, ...rowDimmedStyle }}>
      <td style={tdStyle} aria-hidden />
      <td style={subRowLabelStyle} colSpan={6}>
        <span style={subRowLabelTextStyle}>Image</span>
        <DitherSelect layer={layer} />
        <LinesPerMmInput layer={layer} />
      </td>
    </tr>
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
      title="Threshold: harsh binary. Floyd-Steinberg: photo-style error diffusion. Grayscale: direct luma → S."
      aria-label={`Dither for ${layer.color}`}
    >
      <option value="threshold">Threshold</option>
      <option value="floyd-steinberg">Floyd-Steinberg</option>
      <option value="grayscale">Grayscale</option>
    </select>
  );
}

function LinesPerMmInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.linesPerMm,
    commit: (linesPerMm) => setLayerParam(layer.id, { linesPerMm }),
    parse: (s) => clamp(numericValue(s), 1, 50),
  });
  return (
    <>
      <input
        type="number"
        min={1}
        max={50}
        step={1}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={`Lines per mm for ${layer.color}`}
      />
      <span style={unitStyle}>lines/mm</span>
    </>
  );
}

function PowerInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.power,
    commit: (power) => setLayerParam(layer.id, { power }),
    parse: (s) => clamp(numericValue(s), 0, 100),
  });
  return (
    <>
      <input
        type="number"
        min={0}
        max={100}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={`Power for ${layer.color}`}
      />
      <span style={unitStyle}>%</span>
    </>
  );
}

function SpeedInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const debounced = useDebouncedCommit<number>({
    value: layer.speed,
    commit: (speed) => setLayerParam(layer.id, { speed }),
    parse: (s) => clamp(numericValue(s), 1, maxFeed),
  });
  return (
    <>
      <input
        type="number"
        min={1}
        max={maxFeed}
        value={debounced.displayValue}
        onChange={debounced.onChange}
        onBlur={debounced.onBlur}
        style={inputStyle}
        aria-label={`Speed for ${layer.color}`}
      />
      <span style={unitStyle}>mm/min</span>
    </>
  );
}

function PassesInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.passes,
    commit: (passes) => setLayerParam(layer.id, { passes }),
    parse: (s) => Math.max(1, Math.floor(numericValue(s))),
  });
  return (
    <input
      type="number"
      min={1}
      step={1}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Passes for ${layer.color}`}
    />
  );
}

function VisibleToggle({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <input
      type="checkbox"
      checked={layer.visible}
      onChange={(e) => setLayerParam(layer.id, { visible: e.target.checked })}
      aria-label={`Visibility for ${layer.color}`}
    />
  );
}

function OutputToggle({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <input
      type="checkbox"
      checked={layer.output}
      onChange={(e) => setLayerParam(layer.id, { output: e.target.checked })}
      aria-label={`Output for ${layer.color}`}
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
