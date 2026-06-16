// LayerRow - single card in the Cuts/Layers panel.
//
// The row shell owns selection, ordering, mode, visibility/output toggles, and
// the guarded Cut Settings launcher. The editable numeric fields and the
// dialog wiring live in smaller components so this file stays within the
// project size rules.

import type { Layer, LayerMode } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { AssignSelectionButton } from './AssignSelectionButton';
import { DeleteLayerButton } from './DeleteLayerButton';
import { LayerOrderControls } from './LayerOrderControls';
import { LayerRowCutSettings } from './LayerRowCutSettings';
import { LayerRowSettingsFields } from './LayerRowFields';
import { LayerSettingsClipboardButtons } from './LayerSettingsClipboardButtons';
import { SelectLayerObjectsButton } from './SelectLayerObjectsButton';
import { useCutSettingsLauncher } from './use-cut-settings-launcher';

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
const modeSelectStyle: React.CSSProperties = { fontSize: 13, padding: '2px 4px' };

export function LayerRow(props: {
  readonly layer: Layer;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}): JSX.Element {
  const { layer } = props;
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
      <LayerRowSettingsFields layer={layer} />
      {settingsOpen ? <LayerRowCutSettings layer={layer} onClose={closeSettings} /> : null}
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

function isInteractiveDoubleClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button,input,select,textarea,a,label,[role="button"]') !== null;
}
