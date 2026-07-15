import {
  cutTypeLabel,
  DEFAULT_CNC_LAYER_SETTINGS,
  machineKindOf,
  operationArtworkCount,
  type Layer,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
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
  return (
    <section
      aria-label={`Operation ${props.layer.name}`}
      aria-current={active ? 'true' : undefined}
      style={rowStyle(props.layer.output, active)}
      onClick={() => setActiveLayerColor(props.layer.color)}
    >
      <span
        title={`Automatic operation color ${props.layer.color}`}
        style={{ ...swatchStyle, background: props.layer.color }}
      />
      <div style={identityStyle}>
        <strong style={nameStyle}>{props.layer.name}</strong>
        <span style={summaryStyle}>
          {operationSummary(props.layer, machineKind)} · {artworkCount} artwork
          {artworkCount === 1 ? '' : 's'}
        </span>
      </div>
      <LayerOrderControls
        layer={props.layer}
        canMoveUp={props.canMoveUp}
        canMoveDown={props.canMoveDown}
      />
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
    </section>
  );
}

function operationSummary(layer: Layer, machineKind: 'laser' | 'cnc'): string {
  if (machineKind === 'cnc') {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
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
    gridTemplateColumns: '18px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 8,
    padding: '8px 9px',
    marginBottom: 6,
    border: `1px solid ${active ? 'var(--lf-accent)' : 'var(--lf-border)'}`,
    borderRadius: 6,
    background: 'var(--lf-bg-2)',
    opacity: output ? 1 : 0.58,
  };
}

const swatchStyle: React.CSSProperties = { width: 16, height: 16, borderRadius: 4 };
const identityStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};
const nameStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const summaryStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
