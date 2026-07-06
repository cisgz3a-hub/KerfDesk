// LayerRow - single card in the Cuts/Layers panel.
//
// The row shell owns selection, ordering, mode, visibility/output toggles, and
// the guarded Cut Settings launcher. The editable numeric fields and the
// dialog wiring live in smaller components so this file stays within the
// project size rules.

import {
  captureLayerOperationSettings,
  machineKindOf,
  sceneObjectUsesLayerColor,
  type Layer,
  type LayerMode,
  type LayerOperationSettings,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { AssignSelectionButton } from './AssignSelectionButton';
import { CncLayerFields } from './CncLayerFields';
import { DeleteLayerButton } from './DeleteLayerButton';
import { LayerOrderControls } from './LayerOrderControls';
import { LayerRowCutSettings } from './LayerRowCutSettings';
import { LayerRowSettingsFields, type LayerOperationControlTarget } from './LayerRowFields';
import { LayerSubLayers } from './LayerSubLayers';
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
const selectedBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-accent)',
  background: 'var(--lf-bg)',
  border: '1px solid var(--lf-accent)',
  borderRadius: 4,
  padding: '2px 5px',
};
const compactSelectedHintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};

export function LayerRow(props: {
  readonly layer: Layer;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}): JSX.Element {
  const { layer } = props;
  const activeLayerColor = useUiStore((s) => s.activeLayerColor);
  const setActiveLayerColor = useUiStore((s) => s.setActiveLayerColor);
  const machineKind = useStore((s) => machineKindOf(s.project.machine));
  const { settingsOpen, cutSettingsBlocked, openSettings, closeSettings } =
    useCutSettingsLauncher();
  const isActive = activeLayerColor === layer.color;
  const operationTarget = useLayerOperationTarget(layer);
  // Per-object laser overrides don't apply to CNC compilation; in CNC mode
  // the card always edits the layer's CNC operation.
  const isCncMachine = machineKind === 'cnc';
  const editingSelectedObjects = !isCncMachine && operationTarget.selectedObjectCount > 0;

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
        {editingSelectedObjects || isCncMachine ? null : (
          <ModeSelect layer={layer} operationTarget={operationTarget} />
        )}
        {editingSelectedObjects ? (
          <span style={selectedBadgeStyle}>
            Editing selected ({operationTarget.selectedObjectCount})
          </span>
        ) : null}
        <span style={headerFillerStyle} />
        <SelectLayerObjectsButton layer={layer} />
        <AssignSelectionButton layer={layer} />
        <LayerSettingsClipboardButtons layer={layer} />
        <DeleteLayerButton layer={layer} />
        {isCncMachine ? null : (
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
        )}
        <HeaderToggle label="Show" layer={layer} field="visible" />
        <HeaderToggle label="Output" layer={layer} field="output" />
        <JobAirToggle layer={layer} isCncMachine={isCncMachine} />
      </header>
      {isCncMachine ? (
        <CncLayerFields layer={layer} />
      ) : editingSelectedObjects ? (
        <p style={compactSelectedHintStyle}>
          Use Selected Artwork Settings above for this selection.
        </p>
      ) : (
        <LayerRowSettingsFields layer={layer} operationTarget={operationTarget} />
      )}
      {isCncMachine ? null : <LayerSubLayers layer={layer} />}
      {settingsOpen ? <LayerRowCutSettings layer={layer} onClose={closeSettings} /> : null}
    </section>
  );
}

function JobAirToggle(props: {
  readonly layer: Layer;
  readonly isCncMachine: boolean;
}): JSX.Element | null {
  if (props.isCncMachine) return null;
  return <HeaderToggle label="Job Air" layer={props.layer} field="airAssist" />;
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

function ModeSelect(props: {
  readonly layer: Layer;
  readonly operationTarget: LayerOperationControlTarget;
}): JSX.Element {
  const { layer, operationTarget } = props;
  return (
    <select
      value={operationTarget.settings.mode}
      onChange={(e) => operationTarget.commit({ mode: e.target.value as LayerMode })}
      title={modeSelectTitle(operationTarget)}
      aria-label={`Mode for ${layer.color}`}
      style={modeSelectStyle}
    >
      <option value="line">Line</option>
      <option value="fill">Fill</option>
      <option value="image">Image</option>
    </select>
  );
}

function useLayerOperationTarget(layer: Layer): LayerOperationControlTarget {
  const objects = useStore((s) => s.project.scene.objects);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const setSelectedObjectsOperationOverrideForLayer = useStore(
    (s) => s.setSelectedObjectsOperationOverrideForLayer,
  );
  const selectedObjects = selectedObjectsOnLayer(
    objects,
    selectedObjectId,
    additionalSelectedIds,
    layer.color,
  );
  if (selectedObjects.length === 0) {
    return {
      settings: captureLayerOperationSettings(layer),
      selectedObjectCount: 0,
      commit: (patch) => setLayerParam(layer.id, patch),
    };
  }
  return {
    settings: selectedEffectiveOperationSettings(layer, selectedObjects),
    selectedObjectCount: selectedObjects.length,
    commit: (patch) => setSelectedObjectsOperationOverrideForLayer(layer.color, patch),
  };
}

function selectedObjectsOnLayer(
  objects: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
  layerColor: string,
): ReadonlyArray<SceneObject> {
  const selectedIds = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  return objects.filter(
    (object) => selectedIds.has(object.id) && sceneObjectUsesLayerColor(object, layerColor),
  );
}

function selectedEffectiveOperationSettings(
  layer: Layer,
  objects: ReadonlyArray<SceneObject>,
): LayerOperationSettings {
  return {
    ...captureLayerOperationSettings(layer),
    ...(objects[0]?.operationOverride ?? {}),
  };
}

function modeSelectTitle(operationTarget: LayerOperationControlTarget): string {
  const prefix =
    operationTarget.selectedObjectCount > 0
      ? 'Editing selected artwork only. '
      : 'Editing layer defaults. ';
  return `${prefix}Line: cut along the outline. Fill: hatch a closed shape. Image: raster-engrave a bitmap.`;
}

function HeaderToggle(props: {
  readonly label: string;
  readonly layer: Layer;
  readonly field: 'visible' | 'output' | 'airAssist';
}): JSX.Element {
  const setLayerParam = useStore((s) => s.setLayerParam);
  return (
    <label style={headerToggleStyle}>
      <input
        type="checkbox"
        checked={props.layer[props.field]}
        onChange={(e) => setLayerParam(props.layer.id, { [props.field]: e.target.checked })}
        aria-label={headerToggleAriaLabel(props)}
        title={headerToggleTitle(props.field)}
      />
      {props.label}
    </label>
  );
}

function headerToggleAriaLabel(props: {
  readonly label: string;
  readonly layer: Layer;
  readonly field: 'visible' | 'output' | 'airAssist';
}): string {
  if (props.field === 'airAssist') return `Job air assist for ${props.layer.color}`;
  return `${props.label} for ${props.layer.color}`;
}

function headerToggleTitle(field: 'visible' | 'output' | 'airAssist'): string {
  if (field === 'visible')
    return 'Show or hide this layer on the workspace without changing output.';
  if (field === 'output') {
    return 'Include or exclude this layer from preview, frame, export, and job output.';
  }
  return 'Automatically emit the configured M7/M8 air-assist command for this layer during jobs. Configure the command in Device Profile > Air output.';
}

function isInteractiveDoubleClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button,input,select,textarea,a,label,[role="button"]') !== null;
}
