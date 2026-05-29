// LayerRow — single card in the Cuts/Layers panel.
//
// Layout per layer is a vertical CARD, not a horizontal table row.
// Each setting gets its own field row (label on the left, input + unit
// on the right) so:
//   - Field labels read in full ("Power", "Speed", "Hatch spacing",
//     "Dither", "Resolution") instead of being abbreviated to fit
//     squeezed table columns.
//   - The Image / Fill mode-specific settings just appear as more
//     field rows when the mode demands them — no awkward sub-row
//     spanning a colSpan'd <td>.
//   - The panel uses its vertical space, of which there's plenty.
//
// Number inputs (power / speed / passes / hatch / lines-per-mm) use a
// 300ms debounced commit so typing "1500" doesn't push four undo
// frames (F-A7 — "the LF1 audit found this missing; do not repeat").
// Visible / Output checkboxes commit immediately since each click is
// a single discrete change.

import type { Layer, LayerMode } from '../../core/scene';
import { useStore } from '../state';
import { useDebouncedCommit } from './use-debounced-commit';

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e0e0e0',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const cardDimmedStyle: React.CSSProperties = { opacity: 0.55 };
const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingBottom: 6,
  borderBottom: '1px solid #f0f0f0',
};
const swatchStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 16,
  height: 16,
  flexShrink: 0,
  borderRadius: 3,
};
const headerFillerStyle: React.CSSProperties = { flex: 1 };
const headerToggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: '#666',
};
// A field row inside the card: label on the left at fixed width so
// the inputs align vertically across rows.
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
const wideInputStyle: React.CSSProperties = { width: 80, padding: '2px 6px' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: '#666' };
const ditherSelectStyle: React.CSSProperties = { flex: 1, maxWidth: 180 };
const modeSelectStyle: React.CSSProperties = { fontSize: 13, padding: '2px 4px' };

export function LayerRow({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <section
      style={layer.output ? cardStyle : { ...cardStyle, ...cardDimmedStyle }}
      aria-label={`Layer ${layer.color}`}
    >
      <header style={cardHeaderStyle}>
        <ColorSwatch color={layer.color} visible={layer.visible} />
        <ModeSelect layer={layer} />
        <span style={headerFillerStyle} />
        <HeaderToggle label="Show" layer={layer} field="visible" />
        <HeaderToggle label="Output" layer={layer} field="output" />
      </header>
      <FieldRow label="Power">
        <PowerInput layer={layer} />
        <span style={unitStyle}>%</span>
      </FieldRow>
      <FieldRow label="Speed">
        <SpeedInput layer={layer} />
        <span style={unitStyle}>mm/min</span>
      </FieldRow>
      <FieldRow label="Passes">
        <PassesInput layer={layer} />
      </FieldRow>
      {layer.mode === 'fill' && <FillFields layer={layer} />}
      {layer.mode === 'image' && <ImageFields layer={layer} />}
    </section>
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
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <select
      value={layer.mode}
      onChange={(e) => setLayerParam(layer.id, { mode: e.target.value as LayerMode })}
      title="Line: cut along the outline. Fill: hatch a closed shape. Image: raster-engrave a bitmap."
      aria-label={`Mode for ${layer.color}`}
      style={modeSelectStyle}
    >
      <option value="line">Line</option>
      <option value="fill">Fill</option>
      <option value="image">Image</option>
    </select>
  );
}

function HeaderToggle(props: {
  readonly label: string;
  readonly layer: Layer;
  readonly field: 'visible' | 'output';
}): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <label style={headerToggleStyle}>
      <input
        type="checkbox"
        checked={props.layer[props.field]}
        onChange={(e) => setLayerParam(props.layer.id, { [props.field]: e.target.checked })}
        aria-label={`${props.label} for ${props.layer.color}`}
      />
      {props.label}
    </label>
  );
}

function FillFields({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <>
      <FieldRow label="Hatch angle">
        <HatchAngleInput layer={layer} />
        <span style={unitStyle}>°</span>
      </FieldRow>
      <FieldRow label="Hatch spacing">
        <HatchSpacingInput layer={layer} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
    </>
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
  );
}

function ImageFields({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <>
      <FieldRow label="Dither">
        <DitherSelect layer={layer} />
      </FieldRow>
      <FieldRow label="Resolution">
        <LinesPerMmInput layer={layer} />
        <span style={unitStyle}>lines / mm</span>
      </FieldRow>
    </>
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
      style={ditherSelectStyle}
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
    <input
      type="number"
      min={1}
      max={maxFeed}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={wideInputStyle}
      aria-label={`Speed for ${layer.color}`}
    />
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

function numericValue(s: string): number {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
