import type { Layer } from '../../core/scene';
import { useStore } from '../state';
import { CutSettingsDialog } from './CutSettingsDialog';

export function LayerRowCutSettings(props: {
  readonly layer: Layer;
  readonly onClose: () => void;
}): JSX.Element {
  const { layer, onClose } = props;
  const setLayerParam = useStore((s) => s.setLayerParam);
  const makeLayerDefault = useStore((s) => s.makeLayerDefault);
  const makeLayerDefaultForAll = useStore((s) => s.makeLayerDefaultForAll);
  const resetLayerToDefault = useStore((s) => s.resetLayerToDefault);
  return (
    <CutSettingsDialog
      layer={layer}
      onCancel={onClose}
      onApply={(patch) => {
        setLayerParam(layer.id, patch);
        onClose();
      }}
      onMakeDefault={() => makeLayerDefault(layer.id)}
      onMakeDefaultForAll={() => makeLayerDefaultForAll(layer.id)}
      onResetToDefault={() => resetLayerToDefault(layer.id)}
    />
  );
}
