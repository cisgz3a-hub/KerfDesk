import type { Layer } from '../../core/scene';
import { useStore } from '../state';
import { CutSettingsDialog } from './CutSettingsDialog';
import type { LayerPatch } from './cut-settings-draft';

export function LayerRowCutSettings(props: {
  readonly layer: Layer;
  readonly onClose: () => void;
  readonly onApply?: (patch: LayerPatch) => void;
}): JSX.Element {
  const { layer, onClose } = props;
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const makeLayerDefault = useStore((s) => s.makeLayerDefault);
  const makeLayerDefaultForAll = useStore((s) => s.makeLayerDefaultForAll);
  const resetLayerToDefault = useStore((s) => s.resetLayerToDefault);
  const dialog = (
    <CutSettingsDialog
      layer={layer}
      maxFeed={maxFeed}
      onCancel={onClose}
      onApply={(patch) => {
        (props.onApply ?? ((next) => setLayerParam(layer.id, next)))(patch);
        onClose();
      }}
      {...(props.onApply === undefined
        ? {
            onMakeDefault: () => makeLayerDefault(layer.id),
            onMakeDefaultForAll: () => makeLayerDefaultForAll(layer.id),
            onResetToDefault: () => resetLayerToDefault(layer.id),
          }
        : {})}
    />
  );
  return dialog;
}
