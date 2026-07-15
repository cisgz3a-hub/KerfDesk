import { assertNever, sceneObjectUsesOperation, type Layer, type SceneObject } from '../scene';

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
    if (!hasOutputGeometry(obj)) continue;
    const assignedLayers = outputLayers.filter((layer) => sceneObjectUsesOperation(obj, layer));
    if (
      assignedLayers.length === 0 ||
      assignedLayers.some((layer) => objectCanEmitOnLayer(obj, layer))
    ) {
      continue;
    }
    const [firstLayer] = assignedLayers;
    if (firstLayer !== undefined) {
      issues.push({ code: 'layer-mode-mismatch', message: mismatchMessage(firstLayer) });
    }
  }
  return issues;
}

function hasOutputGeometry(obj: SceneObject): boolean {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return obj.paths.length > 0;
    case 'raster-image':
      return obj.role !== 'trace-source';
    case 'relief':
      return false;
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
