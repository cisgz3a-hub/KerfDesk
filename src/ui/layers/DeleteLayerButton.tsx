import type { Layer } from '../../core/scene';
import { useStore } from '../state';

export function DeleteLayerButton({ layer }: { readonly layer: Layer }): JSX.Element {
  const deleteLayerAndObjects = useStore((state) => state.deleteLayerAndObjects);
  return (
    <button
      type="button"
      className="lf-btn lf-btn--sm lf-btn--danger"
      onClick={() => deleteLayerAndObjects(layer.id)}
      aria-label={`Delete operation ${layer.name}`}
      title="Delete this operation; artwork with no other operation is also removed"
    >
      Delete
    </button>
  );
}
