// Image Studio tool-options bar (ADR-242): brush size/hardness/opacity,
// paint swatches, wand tolerance/contiguity, and the selection actions
// (Delete / Fill / Deselect / Invert). Contextual per active tool.

import type { PaintColor } from '../../core/image-edit';
import { invertMask } from '../../core/image-select';
import { useImageEditorStore } from './image-editor-store';

const SWATCHES: readonly PaintColor[] = [
  { r: 0, g: 0, b: 0 },
  { r: 128, g: 128, b: 128 },
  { r: 255, g: 255, b: 255 },
];

export function EditorOptionsBar(): JSX.Element {
  const tool = useImageEditorStore((s) => s.tool);
  const isPaintTool =
    tool.kind === 'brush' ||
    tool.kind === 'pencil' ||
    tool.kind === 'eraser' ||
    tool.kind === 'line';
  const isSelectTool =
    tool.kind === 'marquee' ||
    tool.kind === 'lasso' ||
    tool.kind === 'wand' ||
    tool.kind === 'move';
  return (
    <div style={barStyle} aria-label="Tool options">
      {isPaintTool ? <PaintOptions showColor={tool.kind !== 'eraser'} /> : null}
      {tool.kind === 'wand' ? <WandOptions /> : null}
      {isSelectTool ? <SelectionActions /> : null}
    </div>
  );
}

function PaintOptions(props: { readonly showColor: boolean }): JSX.Element {
  const brush = useImageEditorStore((s) => s.brush);
  const setBrush = useImageEditorStore((s) => s.setBrush);
  const color = useImageEditorStore((s) => s.color);
  const setColor = useImageEditorStore((s) => s.setColor);
  return (
    <>
      <Slider
        label="Size"
        min={1}
        max={256}
        step={1}
        value={brush.diameterPx}
        onChange={(diameterPx) => setBrush({ diameterPx })}
      />
      <Slider
        label="Hardness"
        min={0}
        max={100}
        step={1}
        value={Math.round(brush.hardness * 100)}
        onChange={(value) => setBrush({ hardness: value / 100 })}
      />
      <Slider
        label="Opacity"
        min={1}
        max={100}
        step={1}
        value={Math.round(brush.opacity * 100)}
        onChange={(value) => setBrush({ opacity: value / 100 })}
      />
      {props.showColor ? (
        <span style={groupStyle} aria-label="Paint colour">
          {SWATCHES.map((swatch) => {
            const isActive = swatch.r === color.r && swatch.g === color.g && swatch.b === color.b;
            return (
              <button
                key={`${swatch.r}-${swatch.g}-${swatch.b}`}
                type="button"
                onClick={() => setColor(swatch)}
                aria-pressed={isActive}
                title={`Paint ${swatch.r === 0 ? 'black' : swatch.r === 255 ? 'white' : 'gray'}`}
                style={{
                  ...swatchStyle,
                  background: `rgb(${swatch.r}, ${swatch.g}, ${swatch.b})`,
                  outline: isActive ? '2px solid var(--lf-accent)' : '1px solid var(--lf-border)',
                }}
              />
            );
          })}
        </span>
      ) : null}
    </>
  );
}

function WandOptions(): JSX.Element {
  const tolerance = useImageEditorStore((s) => s.wandTolerance);
  const setTolerance = useImageEditorStore((s) => s.setWandTolerance);
  const contiguous = useImageEditorStore((s) => s.wandContiguous);
  const setContiguous = useImageEditorStore((s) => s.setWandContiguous);
  return (
    <>
      <Slider
        label="Tolerance"
        min={0}
        max={255}
        step={1}
        value={tolerance}
        onChange={setTolerance}
      />
      <label style={checkStyle}>
        <input
          type="checkbox"
          checked={contiguous}
          onChange={(e) => setContiguous(e.target.checked)}
          title="Select only the connected region under the click; off selects every matching pixel"
        />
        Contiguous
      </label>
    </>
  );
}

function SelectionActions(): JSX.Element {
  const session = useImageEditorStore((s) => s.session);
  const deleteSelection = useImageEditorStore((s) => s.deleteSelection);
  const fillSelection = useImageEditorStore((s) => s.fillSelection);
  const select = useImageEditorStore((s) => s.select);
  const hasSelection = session !== null && session.selection !== null;
  const invert = (): void => {
    if (session?.selection != null) select(invertMask(session.selection));
  };
  return (
    <span style={groupStyle}>
      <ActionButton
        label="Delete"
        title="Clear the selected area to white (Delete)"
        onClick={deleteSelection}
        enabled={hasSelection}
      />
      <ActionButton
        label="Fill"
        title="Fill the selected area with the active paint colour"
        onClick={fillSelection}
        enabled={hasSelection}
      />
      <ActionButton
        label="Invert"
        title="Invert the selection (Ctrl+Shift+I)"
        onClick={invert}
        enabled={hasSelection}
      />
      <ActionButton
        label="Deselect"
        title="Clear the selection (Ctrl+D)"
        onClick={() => select(null)}
        enabled={hasSelection}
      />
    </span>
  );
}

function ActionButton(props: {
  readonly label: string;
  readonly title: string;
  readonly onClick: () => void;
  readonly enabled: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn"
      onClick={props.onClick}
      disabled={!props.enabled}
      title={props.title}
      style={{ padding: '2px 10px' }}
    >
      {props.label}
    </button>
  );
}

function Slider(props: {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label style={sliderStyle}>
      <span style={sliderLabelStyle}>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-label={props.label}
        title={`Adjust the ${props.label.toLowerCase()} for the active tool`}
      />
      <span style={sliderValueStyle}>{props.value}</span>
    </label>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '6px 12px',
  borderBottom: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  minHeight: 34,
  flexWrap: 'wrap',
};
const groupStyle: React.CSSProperties = { display: 'inline-flex', gap: 6, alignItems: 'center' };
const swatchStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
};
const checkStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  alignItems: 'center',
  color: 'var(--lf-text)',
};
const sliderStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 8,
  alignItems: 'center',
  color: 'var(--lf-text-muted)',
};
const sliderLabelStyle: React.CSSProperties = { fontSize: 12 };
const sliderValueStyle: React.CSSProperties = {
  fontSize: 12,
  minWidth: 28,
  textAlign: 'right',
  color: 'var(--lf-text)',
};
