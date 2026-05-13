import type { LaserSettings, Layer, LayerMode } from '../scene/Layer';
import { generateId } from '../types';
import type { MaterialOperation, MaterialPreset } from './MaterialPreset';
import { isDefaultMaterialPresetId } from './defaultPresets';

export type LayerSettingsConfidenceSource =
  | 'built-in-tested'
  | 'user-saved'
  | 'estimated'
  | 'manual-unverified';

export interface LayerSettingsConfidence {
  source: LayerSettingsConfidenceSource;
  tested: {
    presetId: string;
    presetName: string;
    material: string;
    thickness: string;
    operation: LayerMode;
  } | null;
  warning?: string;
}

export interface SaveLayerSettingsAsUserPresetArgs {
  id?: string;
  name: string;
  material: string;
  thickness: string;
  laserWattage: string;
  nowMs?: number;
}

export function confidenceForPreset(
  preset: MaterialPreset,
  operation: LayerMode,
): LayerSettingsConfidence {
  const source: LayerSettingsConfidenceSource =
    isDefaultMaterialPresetId(preset.id) ? 'built-in-tested' : 'user-saved';
  return {
    source,
    tested: {
      presetId: preset.id,
      presetName: preset.name,
      material: preset.material,
      thickness: preset.thickness,
      operation,
    },
  };
}

export function estimatedSettingsConfidence(args: {
  material: string;
  thickness: string;
  operation: LayerMode;
  warning?: string;
}): LayerSettingsConfidence {
  return {
    source: 'estimated',
    tested: null,
    warning: args.warning
      ?? `Estimated ${args.operation} settings for ${args.material} ${args.thickness}; run a material test first.`,
  };
}

export function manualUnverifiedConfidence(warning?: string): LayerSettingsConfidence {
  return {
    source: 'manual-unverified',
    tested: null,
    warning: warning ?? 'Manual values are unverified; run a material test before using them on a real job.',
  };
}

export function markSettingsManualUnverified(
  settings: LaserSettings,
  warning?: string,
): LaserSettings {
  return {
    ...settings,
    settingsConfidence: manualUnverifiedConfidence(warning),
  };
}

export function markLayerSettingsManualUnverified(
  layer: Layer,
  warning?: string,
): Layer {
  return {
    ...layer,
    settings: markSettingsManualUnverified(layer.settings, warning),
  };
}

export function operationFromLayerSettings(settings: LaserSettings): MaterialOperation {
  const op: MaterialOperation = {
    power: settings.power.max,
    speed: settings.speed,
    passes: settings.passes,
    airAssist: settings.airAssist,
  };
  if (settings.mode === 'image') {
    op.dithering = settings.image.dithering;
    op.dpi = settings.image.resolution;
    op.threshold = settings.image.imageThreshold;
  }
  return op;
}

export function buildUserSavedPresetFromLayer(
  layer: Layer,
  args: SaveLayerSettingsAsUserPresetArgs,
): MaterialPreset {
  const id = args.id ?? `preset-user-${args.nowMs != null ? Math.max(0, Math.floor(args.nowMs)) : generateId()}`;
  return {
    id,
    name: args.name,
    material: args.material,
    thickness: args.thickness,
    laserWattage: args.laserWattage,
    operations: {
      [layer.settings.mode]: operationFromLayerSettings(layer.settings),
    },
  };
}
