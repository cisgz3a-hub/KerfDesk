import { machineKindOf, type Layer, type Project, type SceneObject } from '../../core/scene';

// Preview reflects the compiled job, so this predicate must match what the
// active machine's compiler consumes: laser cuts vectors by layer mode and
// engraves rasters; CNC cuts vectors regardless of the (laser-only) layer
// mode, roughs reliefs (H.5), and drops rasters (ADR-101 §4).
export function hasPreviewableContent(project: Project): boolean {
  const outputLayers = new Map(
    project.scene.layers.filter((layer) => layer.output).map((layer) => [layer.color, layer]),
  );
  const isCncMachine = machineKindOf(project.machine) === 'cnc';
  return project.scene.objects.some((object) =>
    objectHasOutputGeometry(object, outputLayers, isCncMachine),
  );
}

function objectHasOutputGeometry(
  object: SceneObject,
  outputLayers: ReadonlyMap<string, Layer>,
  isCncMachine: boolean,
): boolean {
  if (object.kind === 'raster-image') {
    if (object.role === 'trace-source') return false;
    if (isCncMachine) return false;
    return outputLayers.get(object.color)?.mode === 'image';
  }
  if (object.kind === 'relief') {
    return isCncMachine && outputLayers.has(object.color);
  }
  return object.paths.some((path) => {
    const layer = outputLayers.get(path.color);
    if (layer === undefined) return false;
    // The laser Image mode rasterizes the layer's bitmap, not its vectors;
    // the CNC compiler has no Image mode and cuts the vectors.
    if (!isCncMachine && layer.mode === 'image') return false;
    return path.polylines.some((polyline) => polyline.points.length >= 2);
  });
}
