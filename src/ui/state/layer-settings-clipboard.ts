// Copy and Paste settings for operations: what is copied, how a CNC setup is
// pasted onto another operation, and when a paste would change nothing.

import {
  LAYER_OPERATION_SETTING_KEYS,
  layerOperationSettingsEqual,
  type Layer,
  type LayerOperationSettings,
  type LayerSubLayer,
} from '../../core/scene';
import { cncSettingsForArtworkPaste } from './cnc-settings-clipboard';

export type LayerSettingsClipboard = Omit<Layer, 'id' | 'name' | 'color'>;

export function layerSettingsFrom(layer: Layer): LayerSettingsClipboard {
  // Every operation setting the scene compares, read from its one list so a
  // new setting (ADR-670's tone curve was missed here) is copied too. Each is
  // written even when unset, so pasting settings that never used perforation,
  // overcut, image overscan, a tab layout or tab power (ADR-494), a scan
  // pattern (ADR-492), automatic overscan (ADR-495), leads (ADR-626) or a tone
  // curve (ADR-670) turns them off on the target.
  const settings: Record<string, unknown> = {};
  for (const key of LAYER_OPERATION_SETTING_KEYS) settings[key] = layer[key];
  return {
    ...(settings as LayerOperationSettings),
    visible: layer.visible,
    output: layer.output,
    subLayers: layer.subLayers,
    ...(layer.materialBinding === undefined ? {} : { materialBinding: layer.materialBinding }),
    ...(layer.cnc === undefined ? {} : { cnc: layer.cnc }),
  };
}

export function layerSettingsForPaste(
  target: Layer,
  copied: LayerSettingsClipboard,
): LayerSettingsClipboard {
  return copied.cnc === undefined
    ? copied
    : { ...copied, cnc: cncSettingsForArtworkPaste(copied.cnc, target.cnc) };
}

export function layerSettingsEqual(layer: Layer, settings: LayerSettingsClipboard): boolean {
  return (
    layerOperationSettingsEqual(layer, settings) &&
    layer.visible === settings.visible &&
    layer.output === settings.output &&
    subLayersEqual(layer.subLayers, settings.subLayers) &&
    (settings.materialBinding === undefined ||
      JSON.stringify(layer.materialBinding) === JSON.stringify(settings.materialBinding)) &&
    (settings.cnc === undefined || JSON.stringify(layer.cnc) === JSON.stringify(settings.cnc))
  );
}

function subLayersEqual(
  left: ReadonlyArray<LayerSubLayer>,
  right: ReadonlyArray<LayerSubLayer>,
): boolean {
  return (
    left.length === right.length &&
    left.every((subLayer, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        subLayer.id === other.id &&
        subLayer.label === other.label &&
        subLayer.enabled === other.enabled &&
        layerOperationSettingsEqual(subLayer.settings, other.settings)
      );
    })
  );
}
