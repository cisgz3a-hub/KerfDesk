import { LAYER_DEFAULTS, type Layer, type LayerMode, type Project } from '../../core/scene';

export function detectJobIntentWarnings(project: Project): ReadonlyArray<string> {
  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (usesUncalibratedDefaults(layer)) warnings.push(uncalibratedLayerWarning(layer.id));
  }

  const outputLayersByColor = new Map(
    project.scene.layers.filter((layer) => layer.output).map((layer) => [layer.color, layer]),
  );
  const seen = new Set<string>();

  for (const obj of project.scene.objects) {
    if (obj.kind !== 'traced-image') continue;
    for (const path of obj.paths) {
      const layer = outputLayersByColor.get(path.color);
      if (layer === undefined || layer.mode === 'image') continue;
      const key = `${obj.id}:${layer.id}:${layer.mode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push(traceVectorWarning(obj.source, layer.mode));
    }
  }

  return warnings;
}

function usesUncalibratedDefaults(layer: Layer): boolean {
  return (
    layer.output &&
    layer.power === LAYER_DEFAULTS.power &&
    layer.speed === LAYER_DEFAULTS.speed &&
    layer.passes === LAYER_DEFAULTS.passes
  );
}

function uncalibratedLayerWarning(layerId: string): string {
  return `Layer ${layerId} is still using uncalibrated defaults: ${LAYER_DEFAULTS.power}% power, ${LAYER_DEFAULTS.speed} mm/min, ${LAYER_DEFAULTS.passes} pass. Run a material test on scrap before burning final material.`;
}

function traceVectorWarning(source: string, mode: Exclude<LayerMode, 'image'>): string {
  return `Trace "${source}" is vector ${modeLabel(mode)} output, not raster image engraving. It will run with M3 constant-power moves and can cut if power/speed are too aggressive.`;
}

function modeLabel(mode: Exclude<LayerMode, 'image'>): string {
  return mode === 'fill' ? 'Fill' : 'Line';
}
