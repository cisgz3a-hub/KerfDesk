// Copy and Paste settings for operations: what is copied, how a CNC setup is
// pasted onto another operation, and when a paste would change nothing.

import { layerOperationSettingsEqual, type Layer, type LayerSubLayer } from '../../core/scene';
import { cncSettingsForArtworkPaste } from './cnc-settings-clipboard';

export type LayerSettingsClipboard = Omit<Layer, 'id' | 'name' | 'color'>;

const LAYER_SETTING_KEYS = [
  'mode',
  'powerMode',
  'minPower',
  'power',
  'speed',
  'passes',
  'airAssist',
  'kerfOffsetMm',
  'tabsEnabled',
  'tabSizeMm',
  'tabsPerShape',
  'tabSkipInnerShapes',
  'visible',
  'output',
  'hatchAngleDeg',
  'hatchSpacingMm',
  'fillOverscanMm',
  'fillStyle',
  'fillBidirectional',
  'fillCrossHatch',
  'ditherAlgorithm',
  'linesPerMm',
  'imageBidirectional',
  'negativeImage',
  'passThrough',
  'dotWidthCorrectionMm',
  'perforationEnabled',
  'perforationCutMm',
  'perforationSkipMm',
  'overcutMm',
  'imageOverscanMm',
  'tabLayout',
  'tabSpacingMm',
  'tabMaxPerShape',
  'tabCutPowerPercent',
  'imageScanAngleDeg',
  'imageCrossHatch',
  'passAngleStepDeg',
  'autoOverscan',
  'leadInEnabled',
  'leadOutEnabled',
  'leadStyle',
  'leadLengthMm',
  'leadAngleDeg',
  'leadSide',
  'subLayers',
] as const satisfies ReadonlyArray<keyof LayerSettingsClipboard>;

export function layerSettingsFrom(layer: Layer): LayerSettingsClipboard {
  return {
    mode: layer.mode,
    ...(layer.powerMode !== undefined ? { powerMode: layer.powerMode } : {}),
    minPower: layer.minPower,
    power: layer.power,
    speed: layer.speed,
    passes: layer.passes,
    airAssist: layer.airAssist,
    kerfOffsetMm: layer.kerfOffsetMm,
    tabsEnabled: layer.tabsEnabled,
    tabSizeMm: layer.tabSizeMm,
    tabsPerShape: layer.tabsPerShape,
    tabSkipInnerShapes: layer.tabSkipInnerShapes,
    visible: layer.visible,
    output: layer.output,
    hatchAngleDeg: layer.hatchAngleDeg,
    hatchSpacingMm: layer.hatchSpacingMm,
    fillOverscanMm: layer.fillOverscanMm,
    fillStyle: layer.fillStyle,
    fillBidirectional: layer.fillBidirectional,
    fillCrossHatch: layer.fillCrossHatch,
    ditherAlgorithm: layer.ditherAlgorithm,
    linesPerMm: layer.linesPerMm,
    imageBidirectional: layer.imageBidirectional,
    negativeImage: layer.negativeImage,
    passThrough: layer.passThrough,
    dotWidthCorrectionMm: layer.dotWidthCorrectionMm,
    // Explicitly undefined when unset, so pasting settings that never used
    // perforation, overcut, image overscan, a tab layout or tab power
    // (ADR-494), a scan pattern (ADR-492), automatic overscan (ADR-495) or
    // leads (ADR-626) turns them off on the target.
    perforationEnabled: layer.perforationEnabled,
    perforationCutMm: layer.perforationCutMm,
    perforationSkipMm: layer.perforationSkipMm,
    overcutMm: layer.overcutMm,
    imageOverscanMm: layer.imageOverscanMm,
    tabLayout: layer.tabLayout,
    tabSpacingMm: layer.tabSpacingMm,
    tabMaxPerShape: layer.tabMaxPerShape,
    tabCutPowerPercent: layer.tabCutPowerPercent,
    imageScanAngleDeg: layer.imageScanAngleDeg,
    imageCrossHatch: layer.imageCrossHatch,
    passAngleStepDeg: layer.passAngleStepDeg,
    autoOverscan: layer.autoOverscan,
    leadInEnabled: layer.leadInEnabled,
    leadOutEnabled: layer.leadOutEnabled,
    leadStyle: layer.leadStyle,
    leadLengthMm: layer.leadLengthMm,
    leadAngleDeg: layer.leadAngleDeg,
    leadSide: layer.leadSide,
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
    LAYER_SETTING_KEYS.every((key) =>
      key === 'subLayers'
        ? subLayersEqual(layer.subLayers, settings.subLayers)
        : layer[key] === settings[key],
    ) &&
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
