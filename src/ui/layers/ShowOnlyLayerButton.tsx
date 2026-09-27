import type { Layer } from '../../core/scene';
import { useStore } from '../state';

export function ShowOnlyLayerButton({ layer }: { readonly layer: Layer }): JSX.Element {
  const showOnlyLayer = useStore((state) => state.showOnlyLayer);
  return (
    <button
      type="button"
      onClick={() => showOnlyLayer(layer.id)}
      aria-label={`Show only ${layer.name}`}
      title="Show this operation and hide every other operation on the workspace"
    >
      Show only this
    </button>
  );
}
