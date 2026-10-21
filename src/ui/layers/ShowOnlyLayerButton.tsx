import type { Layer } from '../../core/scene';
import { useStore } from '../state';

export function ShowOnlyLayerButton({ layer }: { readonly layer: Layer }): JSX.Element {
  const showOnlyLayer = useStore((state) => state.showOnlyLayer);
  return (
    <button
      type="button"
      className="lf-btn lf-btn--sm"
      onClick={() => showOnlyLayer(layer.id)}
      aria-label={`Show only ${layer.name}`}
      title="Show this operation and hide every other operation on the workspace"
      // It changes every operation's visibility (edit glow, ADR-646 Amendment 1).
      data-edit-scope="everything"
    >
      Show only this
    </button>
  );
}
