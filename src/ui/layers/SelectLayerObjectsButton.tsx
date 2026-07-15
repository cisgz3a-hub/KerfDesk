import type { Layer } from '../../core/scene';
import { useStore } from '../state';

export function SelectLayerObjectsButton({ layer }: { readonly layer: Layer }): JSX.Element {
  const selectObjectsOnLayer = useStore((state) => state.selectObjectsOnLayer);
  return (
    <button
      type="button"
      onClick={() => selectObjectsOnLayer(layer.id)}
      aria-label={`Select all artwork using ${layer.name}`}
      title="Select all artwork using this operation"
    >
      Select
    </button>
  );
}
