import type {
  VectorFillGroup,
  VectorFillObject,
  VectorFillPath,
} from '../../core/raster/rasterize-vector-fill';
import type { ColoredPath, Polyline } from '../../core/scene';
import type { BitmapConversionOptions, BitmapLayerSetting } from './bitmap-assembly';

export type BitmapFillPath = ColoredPath & VectorFillPath;
export type BitmapFillObject = { readonly paths: ReadonlyArray<BitmapFillPath> };

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
  const byColor = new Map(layers.map((layer) => [layer.color.toLowerCase(), layer]));
  const groups = new Map<string, VectorFillObject[]>();
  const outlinePolylines: Polyline[] = [];
  for (const object of objects) {
    const pathsByOperation = new Map<string, VectorFillPath[]>();
    for (const path of object.paths) {
      const operations = operationsForPath(path, byId, byColor);
      if (operations.length === 0 || operations.some((operation) => operation.mode !== 'fill')) {
        outlinePolylines.push(...path.polylines);
      }
      const added = new Set<string>();
      for (const operation of operations) {
        if (operation.mode !== 'fill') continue;
        const key =
          operation.id === undefined
            ? `color:${operation.color.toLowerCase()}`
            : `id:${operation.id}`;
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

function operationsForPath(
  path: BitmapFillPath,
  byId: ReadonlyMap<string, BitmapLayerSetting>,
  byColor: ReadonlyMap<string, BitmapLayerSetting>,
): ReadonlyArray<BitmapLayerSetting> {
  if (path.operationIds === undefined) {
    const operation = byColor.get(path.color.toLowerCase());
    return operation === undefined ? [] : [operation];
  }
  return path.operationIds.flatMap((id) => {
    const operation = byId.get(id);
    return operation === undefined ? [] : [operation];
  });
}
