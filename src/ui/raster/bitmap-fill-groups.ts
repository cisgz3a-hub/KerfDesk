import type {
  VectorFillGroup,
  VectorFillObject,
  VectorFillPath,
} from '../../core/raster/rasterize-vector-fill';
import type { ColoredPath, Polyline, SceneObject } from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import type { BitmapConversionOptions, BitmapLayerSetting } from './bitmap-assembly';
import { bitmapOperationLayers } from './bitmap-operation-settings';

export type BitmapFillPath = ColoredPath & VectorFillPath;
export type BitmapFillObject = Pick<SceneObject, 'operationOverride'> & {
  readonly paths: ReadonlyArray<BitmapFillPath>;
};

export function bitmapFillGroups(
  objects: ReadonlyArray<BitmapFillObject>,
  options: BitmapConversionOptions,
): {
  readonly fillGroups: ReadonlyArray<VectorFillGroup>;
  readonly outlinePolylines: ReadonlyArray<Polyline>;
} {
  const renderType = options.renderType ?? 'fill-all';
  if (renderType === 'fill-all') return { fillGroups: [{ objects }], outlinePolylines: [] };
  if (renderType === 'outlines') {
    return {
      fillGroups: [],
      outlinePolylines: objects.flatMap((o) => o.paths.flatMap((p) => p.polylines)),
    };
  }
  return cutSettingGroups(objects, options.layers ?? []);
}

function cutSettingGroups(
  objects: ReadonlyArray<BitmapFillObject>,
  layers: ReadonlyArray<BitmapLayerSetting>,
): {
  readonly fillGroups: ReadonlyArray<VectorFillGroup>;
  readonly outlinePolylines: ReadonlyArray<Polyline>;
} {
  const byId = new Map(
    layers.flatMap((layer) => (layer.id === undefined ? [] : [[layer.id, layer] as const])),
  );
  const byColor = layersByColor(layers);
  const expanded = new Map(layers.map((layer) => [layer, bitmapOperationLayers(layer)]));
  const groups = new Map<string, VectorFillObject[]>();
  const outlinePolylines: Polyline[] = [];
  for (const object of objects) {
    const pathsByOperation = new Map<string, VectorFillPath[]>();
    for (const path of object.paths) {
      const boundLayers = operationsForPath(path, byId, byColor);
      const operations = boundLayers.flatMap((layer) =>
        (expanded.get(layer) ?? []).map((operation) =>
          effectiveOperationForObject(operation, object),
        ),
      );
      if (boundLayers.length === 0 || operations.some((operation) => operation.mode !== 'fill')) {
        for (const polyline of path.polylines) outlinePolylines.push(polyline);
      }
      const added = new Set<string>();
      for (const operation of operations) {
        if (operation.mode !== 'fill') continue;
        const key = operation.id;
        if (added.has(key)) continue;
        added.add(key);
        const paths = pathsByOperation.get(key) ?? [];
        paths.push(path);
        pathsByOperation.set(key, paths);
      }
    }
    for (const [key, paths] of pathsByOperation) {
      const members = groups.get(key) ?? [];
      members.push({ paths });
      groups.set(key, members);
    }
  }
  return {
    fillGroups: [...groups.values()].map((members) => ({ objects: members })),
    outlinePolylines,
  };
}

function layersByColor(
  layers: ReadonlyArray<BitmapLayerSetting>,
): ReadonlyMap<string, ReadonlyArray<BitmapLayerSetting>> {
  const byColor = new Map<string, BitmapLayerSetting[]>();
  for (const layer of layers) {
    const color = layer.color.toLowerCase();
    const operations = byColor.get(color) ?? [];
    operations.push(layer);
    byColor.set(color, operations);
  }
  return byColor;
}

function operationsForPath(
  path: BitmapFillPath,
  byId: ReadonlyMap<string, BitmapLayerSetting>,
  byColor: ReadonlyMap<string, ReadonlyArray<BitmapLayerSetting>>,
): ReadonlyArray<BitmapLayerSetting> {
  if (path.operationIds === undefined) {
    return byColor.get(path.color.toLowerCase()) ?? [];
  }
  return path.operationIds.flatMap((id) => {
    const operation = byId.get(id);
    return operation === undefined ? [] : [operation];
  });
}
