import type { Layer } from '../../core/scene';
import { useStore } from '../state';

export function LayerSettingsClipboardButtons({ layer }: { readonly layer: Layer }): JSX.Element {
  const copyLayerSettings = useStore((state) => state.copyLayerSettings);
  const pasteLayerSettings = useStore((state) => state.pasteLayerSettings);
  const canPaste = useStore((state) => state.copiedLayerSettings !== null);
  return (
    <>
      <button
        type="button"
        onClick={() => copyLayerSettings(layer.id)}
        aria-label={`Copy settings from ${layer.color}`}
        title="Copy this layer's settings"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={() => pasteLayerSettings(layer.id)}
        aria-label={`Paste settings to ${layer.color}`}
        title="Paste copied settings onto this layer"
        disabled={!canPaste}
      >
        Paste
      </button>
    </>
  );
}
