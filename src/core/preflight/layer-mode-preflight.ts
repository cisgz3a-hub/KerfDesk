import { assertNever, type Layer, type SceneObject } from '../scene';

export type LayerModeMismatchIssue = {
  readonly code: 'layer-mode-mismatch';
  readonly message: string;
};

export function findLayerModeMismatchIssues(
  objects: ReadonlyArray<SceneObject>,
  outputLayers: ReadonlyArray<Layer>,
): ReadonlyArray<LayerModeMismatchIssue> {
  const issues: LayerModeMismatchIssue[] = [];
  for (const obj of objects) {
    for (const color of objectOutputColors(obj)) {
      const layers = outputLayers.filter((layer) => layer.color === color);
      if (layers.length === 0 || layers.some((layer) => objectCanEmitOnLayer(obj, layer))) {
        continue;
      }
      const layer = layers[0];
      if (layer !== undefined) {
        issues.push({ code: 'layer-mode-mismatch', message: mismatchMessage(layer) });
      }
    }
  }
  return issues;
}

function objectOutputColors(obj: SceneObject): ReadonlyArray<string> {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return Array.from(new Set(obj.paths.map((path) => path.color)));
    case 'raster-image':
      return obj.role === 'trace-source' ? [] : [obj.color];
    case 'relief':
      return [];
    default:
      return assertNever(obj, 'SceneObject');
  }
}

function objectCanEmitOnLayer(obj: SceneObject, layer: Layer): boolean {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return layer.mode !== 'image';
    case 'raster-image':
      return obj.role !== 'trace-source' && layer.mode === 'image';
    case 'relief':
      return false;
    default:
      return assertNever(obj, 'SceneObject');
  }
}

function mismatchMessage(layer: Layer): string {
  return layer.mode === 'image'
    ? `Layer ${layer.id} is in Image mode but has vector objects assigned; they will not be engraved. Set the layer to Line or Fill, or move the objects to another layer.`
    : `Layer ${layer.id} is in ${layer.mode === 'fill' ? 'Fill' : 'Line'} mode but has an image assigned; it will not be engraved. Set the layer to Image mode.`;
}
