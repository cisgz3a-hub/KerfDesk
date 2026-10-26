import {
  cutTypeLabel,
  DEFAULT_CNC_LAYER_SETTINGS,
  machineKindOf,
  operationArtworkCount,
  sceneObjectUsesOperation,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { Icon } from '../kit';
import { DeleteLayerButton } from './DeleteLayerButton';
import { LayerFocusTestNotice } from './LayerFocusTestNotice';
import { LayerOrderControls } from './LayerOrderControls';
import { LayerSettingsClipboardButtons } from './LayerSettingsClipboardButtons';
import { SelectLayerObjectsButton } from './SelectLayerObjectsButton';
import { ShowOnlyLayerButton } from './ShowOnlyLayerButton';
import { useOperationRowHover } from './use-operation-row-hover';
import { useSettingsEditGlow } from './use-settings-edit-glow';

export function LayerRow(props: {
  readonly layer: Layer;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}): JSX.Element {
  const activeLayerColor = useUiStore((state) => state.activeLayerColor);
  const setActiveLayerColor = useUiStore((state) => state.setActiveLayerColor);
  const machineKind = useStore((state) => machineKindOf(state.project.machine));
  const objects = useStore((state) => state.project.scene.objects);
  const setLayerParam = useStore((state) => state.setLayerParam);
  const active = activeLayerColor === props.layer.color;
  const artworkCount = operationArtworkCount(objects, props.layer);
  const activate = (): void => setActiveLayerColor(props.layer.color);
  const { hover, menuGlow } = useOperationRowPulse(props.layer, objects);
  return (
    <section
      aria-label={`Operation ${props.layer.name}`}
      aria-current={active ? 'true' : undefined}
      className="lf-operation-card"
      style={rowStyle(props.layer.output, active)}
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
      onFocus={hover.onFocus}
      onBlur={hover.onBlur}
    >
      <OperationActivation
        layer={props.layer}
        machineKind={machineKind}
        artworkCount={artworkCount}
        isActive={active}
        onActivate={activate}
      />
      <LayerFocusTestNotice layer={props.layer} glow={menuGlow} />
      <button
        type="button"
        className="lf-btn lf-btn--ghost lf-operation-card__visibility"
        aria-label={`${props.layer.visible ? 'Hide' : 'Show'} operation ${props.layer.name}`}
        aria-pressed={props.layer.visible}
        title={`${props.layer.visible ? 'Hide' : 'Show'} this operation on the workspace`}
        onClick={() => setLayerParam(props.layer.id, { visible: !props.layer.visible })}
      >
        <Icon name="eye" size={18} />
      </button>
      <OperationManagement {...props} glow={menuGlow} />
    </section>
  );
}

/**
 * The row pulses its operation and every operation with the same settings
 * (ADR-620). Its More controls and Remove Focus Test Z act on this operation
 * alone, so focus there lights exactly this operation's artwork instead;
 * Show only changes every operation, so it lights all artwork (ADR-646
 * Amendment 1).
 */
function useOperationRowPulse(layer: Layer, objects: ReadonlyArray<SceneObject>) {
  const owner = `operation-row:${layer.id}`;
  const layers = useStore((state) => state.project.scene.layers);
  const menuGlow = useSettingsEditGlow({
    owner,
    objectIds: objects
      .filter((object) => sceneObjectUsesOperation(object, layer))
      .map((object) => object.id),
    operationIds: [layer.id],
    scopes: {
      everything: {
        objectIds: objects.map((object) => object.id),
        operationIds: layers.map((each) => each.id),
      },
    },
  });
  const editing = useUiStore((state) => state.editedArtwork?.owner === owner);
  return { hover: useOperationRowHover(layer.id, editing), menuGlow };
}

// Visibility is not repeated here: the eye on the row owns it. Output stays,
// because the editor cannot reach an operation whose artwork is all locked,
// or one with no artwork (ADR-631).
function OperationManagement(props: {
  readonly layer: Layer;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly glow: ReturnType<typeof useSettingsEditGlow>;
}): JSX.Element {
  return (
    <details className="lf-operation-card__management">
      <summary
        aria-label={`More controls for ${props.layer.name}`}
        title="Operation order, output, selection, clipboard and delete controls"
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
      >
        <Icon name="more" size={18} />
      </summary>
      <div
        className="lf-operation-card__management-body lf-operation-menu"
        onFocus={props.glow.onFocus}
        onBlur={props.glow.onBlur}
      >
        <div className="lf-operation-menu__group">
          <span className="lf-operation-menu__label">Order</span>
          <LayerOrderControls {...props} />
        </div>
        <OperationOutputToggle layer={props.layer} />
        <div className="lf-operation-menu__actions">
          <SelectLayerObjectsButton layer={props.layer} />
          <ShowOnlyLayerButton layer={props.layer} />
        </div>
        <div className="lf-operation-menu__actions">
          <LayerSettingsClipboardButtons layer={props.layer} />
        </div>
        <div className="lf-operation-menu__danger">
          <DeleteLayerButton layer={props.layer} />
        </div>
      </div>
    </details>
  );
}

function OperationOutputToggle({ layer }: { readonly layer: Layer }): JSX.Element {
  const setLayerParam = useStore((state) => state.setLayerParam);
  const title = 'Include this operation in preview and machine output';
  return (
    <label className="lf-operation-menu__toggle" title={title}>
      <input
        type="checkbox"
        checked={layer.output}
        aria-label={`Include in output: ${layer.name}`}
        title={title}
        onChange={(event) => setLayerParam(layer.id, { output: event.target.checked })}
      />
      Include in output
    </label>
  );
}

function OperationActivation(props: {
  readonly layer: Layer;
  readonly machineKind: 'laser' | 'cnc';
  readonly artworkCount: number;
  readonly isActive: boolean;
  readonly onActivate: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`Activate operation ${props.layer.name}`}
      aria-pressed={props.isActive}
      title={`Make ${props.layer.name} the active drawing operation`}
      style={activationStyle}
      onClick={props.onActivate}
    >
      <span
        aria-hidden="true"
        title={`Automatic operation color ${props.layer.color}`}
        style={{ ...swatchStyle, background: props.layer.color }}
      />
      <span style={identityStyle}>
        <strong style={nameStyle}>
          {props.layer.name}
          {props.isActive ? <span style={activeBadgeStyle}>Active</span> : null}
        </strong>
        <span style={summaryStyle}>
          {operationSummary(props.layer, props.machineKind)} · {props.artworkCount} artwork
          {props.artworkCount === 1 ? '' : 's'}
        </span>
      </span>
    </button>
  );
}

function operationSummary(layer: Layer, machineKind: 'laser' | 'cnc'): string {
  if (machineKind === 'cnc') {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.cutType === 'v-carve' && settings.vCarveFlatDepthEnabled === false) {
      return `${cutTypeLabel(settings.cutType)} · flowing geometry depth`;
    }
    return `${cutTypeLabel(settings.cutType)} · ${format(settings.depthMm)} mm deep`;
  }
  const mode = layer.mode === 'fill' ? 'Fill' : layer.mode === 'image' ? 'Image' : 'Line';
  return `${mode} · ${format(layer.power)}% · ${format(layer.speed)} mm/min`;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function rowStyle(output: boolean, active: boolean): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    alignItems: 'center',
    gap: 0,
    padding: '12px 10px',
    marginBottom: 6,
    border: `1px solid ${active ? 'var(--lf-accent)' : 'var(--lf-border)'}`,
    borderRadius: 6,
    background: active ? 'var(--lf-tint-info)' : 'var(--lf-bg-1)',
    opacity: output ? 1 : 0.58,
  };
}

const swatchStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 3,
  border: '1px solid var(--lf-border-strong)',
};
const activationStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'grid',
  gridTemplateColumns: '18px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '0 60px 0 0',
  border: 0,
  background: 'transparent',
  color: 'var(--lf-text)',
  font: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
};
const identityStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};
const nameStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const activeBadgeStyle: React.CSSProperties = {
  padding: '1px 5px',
  border: '1px solid var(--lf-accent)',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
};
const summaryStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-sm)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'normal',
};
