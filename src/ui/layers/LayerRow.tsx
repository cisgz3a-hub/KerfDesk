// LayerRow — single row of the Cuts/Layers panel. Each input field is a thin
// sub-component so this component itself stays under the 80-line function
// limit and the JSX stays readable.
//
// Number inputs (power / speed / passes) use a 300ms debounced commit so
// typing "1500" doesn't push four undo frames (F-A7 — "the LF1 audit found
// this missing; do not repeat"). Visible / Output checkboxes commit
// immediately since each click is a single discrete change.

import type { Layer } from '../../core/scene';
import { useStore } from '../state';
import { useDebouncedCommit } from './use-debounced-commit';

const rowStyle: React.CSSProperties = {};
const rowDimmedStyle: React.CSSProperties = { opacity: 0.5 };
const tdStyle: React.CSSProperties = { padding: '4px 4px', verticalAlign: 'middle' };
const swatchStyle: React.CSSProperties = { display: 'inline-block', width: 12, height: 12 };
const inputStyle: React.CSSProperties = { width: 64 };
const unitStyle: React.CSSProperties = { fontSize: 11, color: '#666', marginLeft: 2 };

export function LayerRow({ layer }: { readonly layer: Layer }): JSX.Element {
  return (
    <tr style={layer.output ? rowStyle : rowDimmedStyle}>
      <td style={tdStyle}>
        <ColorSwatch color={layer.color} visible={layer.visible} />
      </td>
      <td style={tdStyle}>
        <ModeSelect mode={layer.mode} />
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

function ModeSelect({ mode }: { readonly mode: Layer['mode'] }): JSX.Element {
  return (
    <select value={mode} disabled title="Fill / Image disabled in MVP">
      <option value="line">Line</option>
      <option value="fill" disabled>
        Fill (Phase F)
      </option>
      <option value="image" disabled>
        Image (Phase F)
      </option>
    </select>
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
