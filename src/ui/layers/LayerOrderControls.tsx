import type { Layer } from '../../core/scene';
import { useStore } from '../state';

const orderControlStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const orderButtonStyle: React.CSSProperties = {
  width: 22,
  height: 18,
  padding: 0,
  lineHeight: 1,
  fontSize: 11,
};

export function LayerOrderControls(props: {
  readonly layer: Layer;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}): JSX.Element {
  const moveLayer = useStore((s) => s.moveLayer);
  return (
    <span style={orderControlStyle} aria-label={`Order controls for ${props.layer.color}`}>
      <button
        type="button"
        title="Move layer up"
        aria-label={`Move ${props.layer.color} up`}
        disabled={!props.canMoveUp}
        onClick={() => moveLayer(props.layer.id, 'up')}
        style={orderButtonStyle}
      >
        ^
      </button>
      <button
        type="button"
        title="Move layer down"
        aria-label={`Move ${props.layer.color} down`}
        disabled={!props.canMoveDown}
        onClick={() => moveLayer(props.layer.id, 'down')}
        style={orderButtonStyle}
      >
        v
      </button>
    </span>
  );
}
