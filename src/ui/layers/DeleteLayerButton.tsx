import type { Layer } from '../../core/scene';
import { useStore } from '../state';

export function DeleteLayerButton({ layer }: { readonly layer: Layer }): JSX.Element {
  const deleteLayerAndObjects = useStore((state) => state.deleteLayerAndObjects);
  return (
    <button
      type="button"
      onClick={() => deleteLayerAndObjects(layer.id)}
      aria-label={`Delete layer ${layer.color}`}
      title="Delete this layer and its assigned artwork"
    >
      Delete
    </button>
  );
}
