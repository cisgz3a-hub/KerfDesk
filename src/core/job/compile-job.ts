import { type DeviceProfile, toMachineCoords } from '../devices';
import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import { applyAutomaticTabsToPolylines } from '../geometry/tabs-bridges';
import {
  applyTransform,
  assertNever,
  type ColoredPath,
  type Layer,
  layerFromSubLayer,
  type Polyline,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
import { memoizedFillHatching } from './fill-hatching-cache';
import { fillRuleForLayer, layerFillCacheKey } from './fill-rule';
import { type CutSegment, type Group, type Job } from './job';
import { effectiveObjectPowerPercent, objectPowerScalePercent } from './object-power-scale';
import { offsetFillContours } from './offset-fill';
import { compileRasterGroup } from './compile-raster-group';

const MAX_LAYER_FILL_CACHE_ENTRIES = 8;

const layerFillCache = new WeakMap<
  ReadonlyArray<SceneObject>,
  Map<string, ReadonlyArray<Polyline>>
>();

export function compileJob(scene: Scene, device: DeviceProfile): Job {
  const groups: Group[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    for (const operationLayer of outputOperationLayers(layer)) {
      if (operationLayer.mode === 'image') {
        appendRasterGroupsForLayer(groups, scene.objects, operationLayer, device);
        continue;
      }
      groups.push(...compileVectorGroupsForLayer(scene.objects, operationLayer, device));
    }
  }
  return { groups };
}

function outputOperationLayers(layer: Layer): ReadonlyArray<Layer> {
  return [
    layer,
    ...layer.subLayers.map((subLayer) => layerFromSubLayer(layer, subLayer)),
  ].filter((operationLayer) => operationLayer.output);
}

function appendRasterGroupsForLayer(
  groups: Group[],
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): void {
  for (const obj of objects) {
    if (obj.kind !== 'raster-image' || obj.color !== layer.color) continue;
    if (obj.role === 'trace-source') continue;
    groups.push(compileRasterGroup(obj, layer, device));
  }
}

function collectSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): CutSegment[] {
  if (layer.mode === 'fill') return collectFillSegmentsForLayer(objects, layer, device);
  return collectLineSegmentsForLayer(objects, layer, device);
}

function compileVectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Group[] {
  const matchingObjects = objects.filter((obj) => vectorObjectMatchesLayer(obj, layer));
  const sharedScale = sharedObjectPowerScalePercent(matchingObjects);
  if (sharedScale !== undefined) {
    return vectorGroupForLayer(layer, device, collectSegmentsForLayer(objects, layer, device), {
      powerScale: sharedScale,
    });
  }

  const groups: Group[] = [];
  for (const obj of matchingObjects) {
    groups.push(
      ...vectorGroupForLayer(layer, device, collectSegmentsForLayer([obj], layer, device), obj),
    );
  }
  return groups;
}

function vectorGroupForLayer(
  layer: Layer,
  device: DeviceProfile,
  segments: ReadonlyArray<CutSegment>,
  powerSource: SceneObject | { readonly powerScale: number },
): Group[] {
  if (segments.length === 0) return [];
  const common = {
    layerId: layer.id,
    color: layer.color,
    power: effectiveObjectPowerPercent(layer, powerSource),
    speed: Math.min(layer.speed, device.maxFeed),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
    segments,
  };
  return [
    layer.mode === 'fill'
      ? {
          ...common,
          kind: 'fill' as const,
          fillStyle: layer.fillStyle,
          overscanMm: Math.max(0, layer.fillOverscanMm),
        }
      : { ...common, kind: 'cut' as const },
  ];
}

function sharedObjectPowerScalePercent(objects: ReadonlyArray<SceneObject>): number | undefined {
  let sharedScale: number | undefined;
  for (const obj of objects) {
    const scale = objectPowerScalePercent(obj);
    if (sharedScale === undefined) {
      sharedScale = scale;
    } else if (sharedScale !== scale) {
      return undefined;
    }
  }
  return sharedScale;
}

function vectorObjectMatchesLayer(obj: SceneObject, layer: Layer): boolean {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return obj.paths.some((path) => path.color === layer.color);
    case 'raster-image':
      return false;
    default:
      return assertNever(obj, 'SceneObject');
  }
}

function collectLineSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): CutSegment[] {
  const out: CutSegment[] = [];
  for (const obj of objects) {
    appendSegmentsFromObject(obj, layer, device, out);
  }
  if (!layer.tabsEnabled) return out;
  return applyAutomaticTabsToPolylines(
    out.map((segment) => ({ points: segment.polyline, closed: segment.closed })),
    layer,
  ).map((polyline) => ({ polyline: polyline.points, closed: polyline.closed }));
}

function collectFillSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): CutSegment[] {
  const polylines =
    layer.fillStyle === 'offset'
      ? offsetFillContours({
          polylines: collectFillContoursForLayer(objects, layer, device),
          spacingMm: layer.hatchSpacingMm,
        })
      : memoizedLayerFillHatching(objects, layer, device);
  return polylines.map((polyline) => ({
    polyline: polyline.points,
    closed: polyline.closed,
  }));
}

function memoizedLayerFillHatching(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): ReadonlyArray<Polyline> {
  const fillRule = fillRuleForLayer(objects, layer);
  const cacheKey = layerFillCacheKey(layer, device, fillRule);
  let bySettings = layerFillCache.get(objects);
  if (bySettings === undefined) {
    bySettings = new Map<string, ReadonlyArray<Polyline>>();
    layerFillCache.set(objects, bySettings);
  }
  const cached = bySettings.get(cacheKey);
  if (cached !== undefined) return cached;

  const contours = collectFillContoursForLayer(objects, layer, device);
  const hatches = memoizedFillHatching(contours, layer, fillRule);
  if (bySettings.size >= MAX_LAYER_FILL_CACHE_ENTRIES) {
    const oldestKey = bySettings.keys().next().value;
    if (oldestKey !== undefined) bySettings.delete(oldestKey);
  }
  bySettings.set(cacheKey, hatches);
  return hatches;
}

function collectFillContoursForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Polyline[] {
  const out: Polyline[] = [];
  for (const obj of objects) {
    appendFillContoursFromObject(obj, layer, device, out);
  }
  return out;
}

function appendSegmentsFromObject(
  obj: SceneObject,
  layer: Layer,
  device: DeviceProfile,
  out: CutSegment[],
): void {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      appendPathSegments(obj.paths, obj.transform, layer, device, out);
      return;
    case 'raster-image':
      return;
    default:
      assertNever(obj, 'SceneObject');
  }
}

function appendFillContoursFromObject(
  obj: SceneObject,
  layer: Layer,
  device: DeviceProfile,
  out: Polyline[],
): void {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      appendFillPathContours(obj.paths, obj.transform, layer, device, out);
      return;
    case 'raster-image':
      return;
    default:
      assertNever(obj, 'SceneObject');
  }
}

function appendFillPathContours(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  layer: Layer,
  device: DeviceProfile,
  out: Polyline[],
): void {
  for (const path of paths) {
    if (path.color !== layer.color) continue;
    for (const polyline of path.polylines) {
      out.push({
        points: polyline.points.map((p) => toMachineCoords(applyTransform(p, transform), device)),
        closed: polyline.closed,
      });
    }
  }
}

function appendPathSegments(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  layer: Layer,
  device: DeviceProfile,
  out: CutSegment[],
): void {
  for (const path of paths) {
    if (path.color !== layer.color) continue;
    const closedForKerf: Polyline[] = [];
    for (const polyline of path.polylines) {
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, transform), device),
      );
      if (shouldApplyKerf(polyline, layer)) {
        closedForKerf.push({ points, closed: true });
      } else {
        out.push({ polyline: points, closed: polyline.closed });
      }
    }
    for (const offset of offsetClosedPolylinesForKerf(closedForKerf, layer.kerfOffsetMm)) {
      out.push({ polyline: offset.points, closed: true });
    }
  }
}

function shouldApplyKerf(polyline: Polyline, layer: Layer): boolean {
  return layer.mode === 'line' && layer.kerfOffsetMm !== 0 && polyline.closed;
}
