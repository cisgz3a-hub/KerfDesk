import {
  cutTypeLabel,
  DEFAULT_CNC_LAYER_SETTINGS,
  machineKindOf,
  operationArtworkCount,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { Icon } from '../kit';
import { DeleteLayerButton } from './DeleteLayerButton';
import { LayerOrderControls } from './LayerOrderControls';
import { LayerSettingsClipboardButtons } from './LayerSettingsClipboardButtons';
import { SelectLayerObjectsButton } from './SelectLayerObjectsButton';

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
  return (
    <section
      aria-label={`Operation ${props.layer.name}`}
      aria-current={active ? 'true' : undefined}
      className="lf-operation-card"
      style={rowStyle(props.layer.output, active)}
    >
      <OperationActivation
        layer={props.layer}
        machineKind={machineKind}
        artworkCount={artworkCount}
        isActive={active}
        onActivate={activate}
      />
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
      <OperationManagement {...props} />
    </section>
  );
}

function OperationManagement(props: {
  readonly layer: Layer;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}): JSX.Element {
  const setLayerParam = useStore((state) => state.setLayerParam);
  return (
    <details className="lf-operation-card__management">
      <summary
        aria-label={`More controls for ${props.layer.name}`}
        title="Operation order, output, clipboard and delete controls"
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
      >
        <span aria-hidden="true">•••</span>
      </summary>
      <div className="lf-operation-card__management-body">
        <LayerOrderControls {...props} />
        <div style={togglesStyle}>
          <label title="Show or hide this operation on the workspace">
            <input
              type="checkbox"
              checked={props.layer.visible}
              aria-label={`Show ${props.layer.name}`}
              title="Show or hide this operation on the workspace"
              onChange={(event) => setLayerParam(props.layer.id, { visible: event.target.checked })}
            />{' '}
            Show
          </label>
          <label title="Include this operation in preview and machine output">
            <input
              type="checkbox"
              checked={props.layer.output}
              aria-label={`Output ${props.layer.name}`}
              title="Include this operation in preview and machine output"
              onChange={(event) => setLayerParam(props.layer.id, { output: event.target.checked })}
            />{' '}
            Output
          </label>
        </div>
        <div style={actionsStyle}>
          <SelectLayerObjectsButton layer={props.layer} />
          <LayerSettingsClipboardButtons layer={props.layer} />
          <DeleteLayerButton layer={props.layer} />
        </div>
      </div>
    </details>
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
const togglesStyle: React.CSSProperties = {
  gridColumn: '2 / -1',
  display: 'flex',
  gap: 12,
  fontSize: 11,
};
const actionsStyle: React.CSSProperties = {
  gridColumn: '2 / -1',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
};
