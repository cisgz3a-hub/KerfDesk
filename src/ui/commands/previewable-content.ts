import type { Layer, Project, SceneObject } from '../../core/scene';

export function hasPreviewableContent(project: Project): boolean {
  const outputLayers = new Map(
    project.scene.layers.filter((layer) => layer.output).map((layer) => [layer.color, layer]),
  );
  return project.scene.objects.some((object) => objectHasOutputGeometry(object, outputLayers));
}

function objectHasOutputGeometry(
  object: SceneObject,
  outputLayers: ReadonlyMap<string, Layer>,
): boolean {
  if (object.kind === 'raster-image') {
    if (object.role === 'trace-source') return false;
    return outputLayers.get(object.color)?.mode === 'image';
  }
  return object.paths.some((path) => {
    const layer = outputLayers.get(path.color);
    if (layer === undefined || layer.mode === 'image') return false;
    return path.polylines.some((polyline) => polyline.points.length >= 2);
  });
}
