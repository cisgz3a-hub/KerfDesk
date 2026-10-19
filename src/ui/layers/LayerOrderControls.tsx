import type { Layer } from '../../core/scene';
import { useStore } from '../state';
import { IconButton } from '../kit';

export function LayerOrderControls(props: {
  readonly layer: Layer;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}): JSX.Element {
  const moveLayer = useStore((s) => s.moveLayer);
  return (
    <span
      className="lf-operation-order"
      role="group"
      aria-label={`Order controls for ${props.layer.name}`}
    >
      <IconButton
        icon="chevron-up"
        label={`Move ${props.layer.name} up`}
        title="Move operation up"
        disabled={!props.canMoveUp}
        onClick={() => moveLayer(props.layer.id, 'up')}
      />
      <IconButton
        icon="chevron-down"
        label={`Move ${props.layer.name} down`}
        title="Move operation down"
        disabled={!props.canMoveDown}
        onClick={() => moveLayer(props.layer.id, 'down')}
      />
    </span>
  );
}
