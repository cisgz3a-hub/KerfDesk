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
import { useUiStore } from '../state/ui-store';
import { AssignSelectionButton } from './AssignSelectionButton';
import { CutSettingsDialog } from './CutSettingsDialog';
import { DeleteLayerButton } from './DeleteLayerButton';
import { LayerImageFields } from './LayerImageFields';
import { LayerOrderControls } from './LayerOrderControls';
import { LayerSettingsClipboardButtons } from './LayerSettingsClipboardButtons';
import { SelectLayerObjectsButton } from './SelectLayerObjectsButton';
import { useCutSettingsLauncher } from './use-cut-settings-launcher';
import { useDebouncedCommit } from './use-debounced-commit';

const cardStyle: React.CSSProperties = {
  background: 'var(--lf-bg-2)',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const cardDimmedStyle: React.CSSProperties = { opacity: 0.55 };
const cardActiveStyle: React.CSSProperties = {
  border: '1px solid var(--lf-accent)',
  boxShadow: 'inset 3px 0 0 var(--lf-accent)',
};
const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  // The header carries swatch + reorder + mode + six actions + two
  // toggles; without wrapping, anything past the panel width clips off
  // screen and Delete/Edit/Show/Output become unreachable.
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  paddingBottom: 6,
  borderBottom: '1px solid var(--lf-border)',
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
  color: 'var(--lf-text-muted)',
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
  color: 'var(--lf-text-muted)',
};
const fieldValueStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 1,
};
const inputStyle: React.CSSProperties = { width: 70, padding: '2px 6px' };
const wideInputStyle: React.CSSProperties = { width: 80, padding: '2px 6px' };
const unitStyle: React.CSSProperties = { fontSize: 11, color: 'var(--lf-text-faint)' };
const modeSelectStyle: React.CSSProperties = { fontSize: 13, padding: '2px 4px' };

export function LayerRow(props: {
  readonly layer: Layer;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}): JSX.Element {
  const { layer } = props;
  const setLayerParam = useStore((s) => s.setLayerParam);
  const activeLayerColor = useUiStore((s) => s.activeLayerColor);
  const setActiveLayerColor = useUiStore((s) => s.setActiveLayerColor);
  const { settingsOpen, cutSettingsBlocked, openSettings, closeSettings } =
    useCutSettingsLauncher();
  const isActive = activeLayerColor === layer.color;
  return (
    <section
      style={layerCardStyle(layer.output, isActive)}
      aria-label={`Layer ${layer.color}`}
      aria-current={isActive ? 'true' : undefined}
      onClick={() => setActiveLayerColor(layer.color)}
      onDoubleClick={(event) => {
        if (cutSettingsBlocked) return;
        if (isInteractiveDoubleClickTarget(event.target)) return;
        openSettings();
      }}
    >
      <header style={cardHeaderStyle}>
        <ColorSwatch color={layer.color} visible={layer.visible} />
        <LayerOrderControls
          layer={layer}
          canMoveUp={props.canMoveUp}
          canMoveDown={props.canMoveDown}
        />
        <ModeSelect layer={layer} />
        <span style={headerFillerStyle} />
        <SelectLayerObjectsButton layer={layer} />
        <AssignSelectionButton layer={layer} />
        <LayerSettingsClipboardButtons layer={layer} />
        <DeleteLayerButton layer={layer} />
        <button
          type="button"
          onClick={openSettings}
          disabled={cutSettingsBlocked}
          aria-label={`Edit cut settings for ${layer.color}`}
          title={
            cutSettingsBlocked
              ? 'Cut settings are available when the machine is idle.'
              : 'Open advanced cut settings'
          }
        >
          Edit...
        </button>
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
      {layer.mode === 'image' && <LayerImageFields layer={layer} />}
      {settingsOpen ? (
        <CutSettingsDialog
          layer={layer}
          onCancel={closeSettings}
          onApply={(patch) => {
            setLayerParam(layer.id, patch);
            closeSettings();
          }}
        />
      ) : null}
    </section>
  );
}

function layerCardStyle(output: boolean, active: boolean): React.CSSProperties {
  return {
    ...cardStyle,
    ...(!output ? cardDimmedStyle : {}),
    ...(active ? cardActiveStyle : {}),
  };
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
        border: props.visible
          ? '1px solid var(--lf-border-strong)'
          : '1px dashed var(--lf-text-faint)',
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
        title={
          props.field === 'visible'
            ? 'Show or hide this layer on the workspace without changing output.'
            : 'Include or exclude this layer from preview, frame, export, and job output.'
        }
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
      <FieldRow label="Overscan">
        <FillOverscanInput layer={layer} />
        <span style={unitStyle}>mm</span>
      </FieldRow>
      <FieldRow label="Bidirectional">
        <BidirectionalInput layer={layer} />
      </FieldRow>
    </>
  );
}

// Snake (bidirectional) vs unidirectional fill. On = faster (no return travel);
// off = every row burns the same direction, removing the firing-lag zipper that
// can serrate small text (ADR-038). A discrete click, so it commits immediately
// like Visible / Output (no debounce).
function BidirectionalInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <input
      type="checkbox"
      checked={layer.fillBidirectional}
      onChange={(e) => setLayerParam(layer.id, { fillBidirectional: e.target.checked })}
      aria-label={`Bidirectional fill for ${layer.color}`}
      title="Scan alternating fill lines in both directions to reduce travel time."
    />
  );
}

function HatchAngleInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.hatchAngleDeg,
    commit: (hatchAngleDeg) => setLayerParam(layer.id, { hatchAngleDeg }),
    parse: (s) => clamp(numericValue(s, layer.hatchAngleDeg), 0, 180),
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
      title="Fill scan angle in degrees for this layer."
    />
  );
}

function HatchSpacingInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.hatchSpacingMm,
    commit: (hatchSpacingMm) => setLayerParam(layer.id, { hatchSpacingMm }),
    parse: (s) => clamp(numericValue(s, layer.hatchSpacingMm), 0.05, 10),
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
      title="Distance between fill hatch lines. Smaller spacing engraves denser fills."
    />
  );
}

function FillOverscanInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.fillOverscanMm,
    commit: (fillOverscanMm) => setLayerParam(layer.id, { fillOverscanMm }),
    parse: (s) => clamp(numericValue(s, layer.fillOverscanMm), 0, 25),
  });
  return (
    <input
      type="number"
      min={0}
      max={25}
      step={0.5}
      value={debounced.displayValue}
      onChange={debounced.onChange}
      onBlur={debounced.onBlur}
      style={inputStyle}
      aria-label={`Fill overscan for ${layer.color}`}
      title="Extra travel beyond fill edges so the laser reaches speed before firing."
    />
  );
}

function PowerInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.power,
    commit: (power) =>
      setLayerParam(layer.id, { power, minPower: Math.min(layer.minPower, power) }),
    parse: (s) => clamp(numericValue(s, layer.power), 0, 100),
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
      title="Laser power percentage for this layer."
    />
  );
}

function SpeedInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const debounced = useDebouncedCommit<number>({
    value: layer.speed,
    commit: (speed) => setLayerParam(layer.id, { speed }),
    parse: (s) => clamp(numericValue(s, layer.speed), 1, maxFeed),
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
      title="Feed rate in millimeters per minute for this layer."
    />
  );
}

function PassesInput({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  const debounced = useDebouncedCommit<number>({
    value: layer.passes,
    commit: (passes) => setLayerParam(layer.id, { passes }),
    parse: (s) => Math.max(1, Math.floor(numericValue(s, layer.passes))),
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
      title="Number of times this layer is repeated in the job."
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

function isInteractiveDoubleClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button,input,select,textarea,a,label,[role="button"]') !== null;
}
