import type { Layer } from '../../core/scene';
import { useStore } from '../state';

export function AssignSelectionButton({ layer }: { readonly layer: Layer }): JSX.Element {
  const hasSelection = useStore(
    (state) => state.selectedObjectId !== null || state.additionalSelectedIds.size > 0,
  );
  const assignSelectionToLayer = useStore((state) => state.assignSelectionToLayer);
  return (
    <button
      type="button"
      disabled={!hasSelection}
      onClick={() => assignSelectionToLayer(layer.id)}
      aria-label={`Assign selection to ${layer.color}`}
      title="Assign selected artwork to this layer"
    >
      Assign
    </button>
  );
}
