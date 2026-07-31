// DesignLayerRow — one carve layer in the Studio's layers list (ADR-271
// Amendment 1). Click arms the layer for new geometry; the row reads back the
// layer's kind, depth and bit so the whole plan is scannable without opening
// each layer's settings.

import type { CncTool } from '../../../core/scene';
import type { DesignLayer } from '../../../core/design/layers';
import { DESIGN_CUT_TYPE_LABELS } from './design-cut-type-labels';

export function DesignLayerRow(props: {
  readonly layer: DesignLayer;
  readonly isActive: boolean;
  readonly entityCount: number;
  readonly tool: CncTool;
  readonly canRemove: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onSelect: () => void;
  readonly onMove: (direction: 'up' | 'down') => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const { layer } = props;
  const summary = `${DESIGN_CUT_TYPE_LABELS[layer.cutType]} · ${layer.depthMm} mm · ${props.tool.name}`;
  return (
    <div style={{ ...rowStyle, ...(props.isActive ? activeStyle : null) }}>
      <button
        type="button"
        onClick={props.onSelect}
        title={`Draw on "${layer.name}" — new shapes land on the active layer`}
        aria-pressed={props.isActive}
        style={selectStyle}
      >
        <span aria-hidden="true" style={{ ...chipStyle, background: layer.color }} />
        <span style={nameStyle}>
          {layer.name}
          <span style={metaStyle}>
            {summary}
            {props.entityCount > 0
              ? ` · ${props.entityCount} shape${props.entityCount === 1 ? '' : 's'}`
              : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => props.onMove('up')}
        disabled={!props.canMoveUp}
        title="Move this layer up the list"
        style={iconButtonStyle}
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => props.onMove('down')}
        disabled={!props.canMoveDown}
        title="Move this layer down the list"
        style={iconButtonStyle}
      >
        ↓
      </button>
      <button
        type="button"
        onClick={props.onRemove}
        disabled={!props.canRemove}
        title={
          props.canRemove
            ? 'Remove this layer — its shapes move to the first layer'
            : 'A sketch always keeps one layer'
        }
        style={iconButtonStyle}
      >
        ✕
      </button>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  borderRadius: 6,
  border: '1px solid transparent',
  padding: 1,
};

const activeStyle: React.CSSProperties = {
  borderColor: 'var(--lf-accent)',
  background: 'var(--lf-bg-input)',
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 6px',
  border: 'none',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
  textAlign: 'left',
};

const chipStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 3,
  border: '1px solid var(--lf-border)',
  flexShrink: 0,
};

const nameStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.25,
};

const metaStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 400,
  color: 'var(--lf-text-dim)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const iconButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  fontSize: 11,
  borderRadius: 4,
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
  flexShrink: 0,
};
