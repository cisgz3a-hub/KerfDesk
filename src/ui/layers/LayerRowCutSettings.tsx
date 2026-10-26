import type { Layer, LayerMode } from '../../core/scene';
import { useStore } from '../state';
import { layerAfterModeSwitch } from '../state/laser-recipe-seeding';
import { defaultColorForOperation } from '../state/operation-source-color';
import { CutSettingsDialog } from './CutSettingsDialog';
import type { LayerPatch } from './cut-settings-draft';

export function LayerRowCutSettings(props: {
  readonly layer: Layer;
  readonly onClose: () => void;
  readonly onApply?: (patch: LayerPatch) => void;
  readonly selectionCount?: number;
  /** The patch goes to artwork settings: send only the edited fields. */
  readonly onlyChangedFields?: boolean;
}): JSX.Element {
  const { layer, onClose } = props;
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const makeLayerDefault = useStore((s) => s.makeLayerDefault);
  const makeLayerDefaultForAll = useStore((s) => s.makeLayerDefaultForAll);
  const resetLayerToDefault = useStore((s) => s.resetLayerToDefault);
  const makeDefaultColor = useStore((s) =>
    defaultColorForOperation(s.project.scene.objects, layer),
  );
  // Only the operation's own Apply goes through setLayerParam's recipe reseed
  // (ADR-496 §6), so only it previews one.
  const previewModeSwitch = (mode: LayerMode): Layer | undefined => {
    const { project, materialLibrary } = useStore.getState();
    return layerAfterModeSwitch(project, materialLibrary, layer.id, mode);
  };
  const dialog = (
    <CutSettingsDialog
      layer={layer}
      maxFeed={maxFeed}
      operationMembershipEditable={props.onApply === undefined}
      {...(props.selectionCount === undefined ? {} : { selectionCount: props.selectionCount })}
      {...(props.onlyChangedFields === true ? { onlyChangedFields: true } : {})}
      {...(props.onApply === undefined ? { previewModeSwitch } : {})}
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
            makeDefaultColor,
          }
        : {})}
    />
  );
  return dialog;
}
