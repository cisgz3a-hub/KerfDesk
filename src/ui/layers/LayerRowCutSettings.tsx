import { useState } from 'react';
import type { Layer } from '../../core/scene';
import { MaterialPresetWizard } from '../material-library/wizard';
import {
  seedFromOperation,
  type MaterialPresetWizardSeed,
} from '../material-library/wizard/wizard-seed';
import { useStore } from '../state';
import { CutSettingsDialog } from './CutSettingsDialog';
import type { LayerPatch } from './cut-settings-draft';

export function LayerRowCutSettings(props: {
  readonly layer: Layer;
  readonly onClose: () => void;
  readonly onApply?: (patch: LayerPatch) => void;
  readonly selectionCount?: number;
}): JSX.Element {
  const { layer, onClose } = props;
  const maxFeed = useStore((s) => s.project.device.maxFeed);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const makeLayerDefault = useStore((s) => s.makeLayerDefault);
  const makeLayerDefaultForAll = useStore((s) => s.makeLayerDefaultForAll);
  const resetLayerToDefault = useStore((s) => s.resetLayerToDefault);
  const [presetSeed, setPresetSeed] = useState<MaterialPresetWizardSeed | null>(null);
  const dialog = (
    <CutSettingsDialog
      layer={layer}
      maxFeed={maxFeed}
      operationMembershipEditable={props.onApply === undefined}
      {...(props.selectionCount === undefined ? {} : { selectionCount: props.selectionCount })}
      onCancel={onClose}
      onApply={(patch) => {
        (props.onApply ?? ((next) => setLayerParam(layer.id, next)))(patch);
        onClose();
      }}
      onSaveAsPreset={(patch) => setPresetSeed(seedFromOperation({ ...layer, ...patch }))}
      {...(props.onApply === undefined
        ? {
            onMakeDefault: () => makeLayerDefault(layer.id),
            onMakeDefaultForAll: () => makeLayerDefaultForAll(layer.id),
            onResetToDefault: () => resetLayerToDefault(layer.id),
          }
        : {})}
    />
  );
  // The wizard is its own form, so it renders beside the Cut Settings form
  // (stacked on top of it) rather than inside it.
  return (
    <>
      {dialog}
      {presetSeed === null ? null : (
        <MaterialPresetWizard seed={presetSeed} onClose={() => setPresetSeed(null)} />
      )}
    </>
  );
}
