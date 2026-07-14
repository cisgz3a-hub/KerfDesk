// compileJob — Scene + DeviceProfile → Job.
//
// Walks every output-enabled Layer, materializes its polylines from the
// SceneObjects that match its color, applies each object's transform and the
// device's origin transform, and bundles the result with the layer's
// power / speed / passes.
//
// Pure: depends only on its arguments. No clock, no random, no I/O.
// Determinism: iteration order matches scene.layers and scene.objects (both
// arrays, indexed loops) → repeatable across runs.

import { type DeviceProfile, toMachineCoords } from '../devices';
import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import { applyAutomaticTabsToPolylines } from '../geometry/tabs-bridges';
import { effectiveObjectPowerPercent, objectPowerScalePercent } from './object-power-scale';
import {
  applyTransform,
  assertNever,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenColoredPathCurves,
  type ColoredPath,
  type Layer,
  layerOperationSettingsEqual,
  outputOperationLayers,
  type Polyline,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
  withClosingPoint,
} from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import { memoizedFillHatchingWithMetadata } from './fill-hatching-cache';
import { fillRuleForLayer, layerFillCacheKey } from './fill-rule';
import { groupFillContoursIntoIslands } from './island-fill';
import { islandFillMotionPolicyForDevice } from './island-fill-motion';
import { offsetFillContours } from './offset-fill';
import type { CutGroup, CutSegment, FillSegment, Group, Job } from './job';

const MAX_LAYER_FILL_CACHE_ENTRIES = 8;

// Allowed module-level cache (narrow exception to "no module-level mutable") —
// see ADR-050. Identity-keyed via WeakMap (GC-bounded), output-invariant, inner
// map capped at MAX_LAYER_FILL_CACHE_ENTRIES, pinned by compile-job-fill-cache.test.ts.
const layerFillCache = new WeakMap<
  ReadonlyArray<SceneObject>,
  Map<string, ReadonlyArray<FillSegmentAsPolyline>>
>();

export function compileJob(scene: Scene, device: DeviceProfile): Job {
  const groups: Group[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    for (const operationLayer of outputOperationLayers(layer)) {
      if (operationLayer.mode !== 'image') {
        groups.push(...compileVectorGroupsForLayer(scene.objects, operationLayer, device));
      }
      groups.push(...compileRasterGroupsForLayer(scene.objects, operationLayer, device));
    }
  }
  return { groups };
}

function compileVectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Group[] {
  const matchingObjects = objects.filter((obj) => vectorObjectMatchesLayer(obj, layer));
  if (matchingObjects.every((obj) => obj.operationOverride === undefined)) {
    return vectorGroupsForObjects(objects, matchingObjects, layer, device);
  }

  const groups: Group[] = [];
  for (const bucket of vectorObjectBucketsForLayer(objects, layer)) {
    groups.push(...vectorGroupsForObjects(bucket.objects, bucket.objects, bucket.layer, device));
  }
  return groups;
}

function vectorGroupsForObjects(
  sourceObjects: ReadonlyArray<SceneObject>,
  matchingObjects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Group[] {
  const sharedScale = sharedObjectPowerScalePercent(matchingObjects);
  if (sharedScale !== undefined) {
    return vectorGroupsForLayer(sourceObjects, layer, device, { powerScale: sharedScale });
  }
  const groups: Group[] = [];
  for (const obj of matchingObjects) {
    groups.push(...vectorGroupsForLayer([obj], layer, device, obj));
  }
  return groups;
}

function vectorObjectBucketsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
): ReadonlyArray<{ readonly layer: Layer; readonly objects: ReadonlyArray<SceneObject> }> {
  const buckets: Array<{ layer: Layer; objects: SceneObject[] }> = [];
  for (const obj of objects) {
    if (!vectorObjectMatchesLayer(obj, layer)) continue;
    const effectiveLayer = layerWithObjectOverride(layer, obj);
    if (effectiveLayer.mode === 'image') continue;
    const bucket = buckets.find((candidate) =>
      layerOperationSettingsEqual(candidate.layer, effectiveLayer),
    );
    if (bucket === undefined) {
      buckets.push({ layer: effectiveLayer, objects: [obj] });
    } else {
      bucket.objects.push(obj);
    }
  }
  return buckets;
}

function layerWithObjectOverride(layer: Layer, obj: SceneObject): Layer {
  if (obj.operationOverride === undefined) return layer;
  return { ...layer, ...obj.operationOverride };
}

function vectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
): Group[] {
  if (layer.mode === 'fill') {
    if (layer.fillStyle === 'island') {
      return islandFillGroupsForLayer(objects, layer, device, powerSource);
    }
    const segments = collectFillSegmentsForLayer(objects, layer, device);
    if (segments.length === 0) return [];
    const common = commonGroupFields(layer, device, powerSource);
    return [
      {
        ...common,
        kind: 'fill' as const,
        fillStyle: layer.fillStyle,
        overscanMm: Math.max(0, layer.fillOverscanMm),
        segments,
      },
    ];
  }
  const segments = collectLineSegmentsForLayer(objects, layer, device);
  if (segments.length === 0) return [];
  const common = commonGroupFields(layer, device, powerSource);
  return [{ ...common, kind: 'cut' as const, segments }];
}

function islandFillGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
): Group[] {
  const common = commonGroupFields(layer, device, powerSource);
  const fillRule = fillRuleForLayer(objects, layer);
  const contours = collectFillContoursForLayer(objects, layer, device);
  const islandMotionPolicy = islandFillMotionPolicyForDevice(device);
  const sensitiveIslandFill = islandMotionPolicy === 'sensitive';
  const hatchingLayer = sensitiveIslandFill ? { ...layer, fillBidirectional: false } : layer;
  return groupFillContoursIntoIslands(contours, {
    clusterMicroIslands: sensitiveIslandFill,
  }).flatMap((island): Group[] => {
    const segments = memoizedFillHatchingWithMetadata(island, hatchingLayer, fillRule).map(
      (polyline) => ({
        polyline: polyline.points,
        closed: polyline.closed,
        reverse: polyline.reverse,
      }),
    );
    if (segments.length === 0) return [];
    return [
      {
        ...common,
        kind: 'fill',
        fillStyle: 'island',
        ...(sensitiveIslandFill ? { islandMotionPolicy } : {}),
        overscanMm: Math.max(0, layer.fillOverscanMm),
        segments,
      },
    ];
  });
}

function commonGroupFields(
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
): Omit<CutGroup, 'kind' | 'segments'> {
  return {
    layerId: layer.id,
    color: layer.color,
    power: effectiveObjectPowerPercent(layer, powerSource),
    ...(layer.powerMode !== undefined ? { powerMode: layer.powerMode } : {}),
    speed: Math.min(layer.speed, device.maxFeed),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
  };
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
    case 'relief':
      return false;
    default:
      assertNever(obj, 'SceneObject');
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
): FillSegment[] {
  const polylines =
    layer.fillStyle === 'offset'
      ? offsetFillContours({
          polylines: collectFillContoursForLayer(objects, layer, device),
          spacingMm: layer.hatchSpacingMm,
        }).map((polyline) => ({ ...polyline, reverse: false }))
      : memoizedLayerFillHatching(objects, layer, device);
  return polylines.map((polyline) => ({
    polyline: polyline.points,
    closed: polyline.closed,
    reverse: polyline.reverse,
  }));
}

function memoizedLayerFillHatching(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): ReadonlyArray<FillSegmentAsPolyline> {
  const fillRule = fillRuleForLayer(objects, layer);
  const cacheKey = layerFillCacheKey(layer, device, fillRule);
  let bySettings = layerFillCache.get(objects);
  if (bySettings === undefined) {
    bySettings = new Map<string, ReadonlyArray<FillSegmentAsPolyline>>();
    layerFillCache.set(objects, bySettings);
  }
  const cached = bySettings.get(cacheKey);
  if (cached !== undefined) return cached;

  const contours = collectFillContoursForLayer(objects, layer, device);
  const hatches = memoizedFillHatchingWithMetadata(contours, layer, fillRule);
  if (bySettings.size >= MAX_LAYER_FILL_CACHE_ENTRIES) {
    const oldestKey = bySettings.keys().next().value;
    if (oldestKey !== undefined) bySettings.delete(oldestKey);
  }
  bySettings.set(cacheKey, hatches);
  return hatches;
}

type FillSegmentAsPolyline = Polyline & { readonly reverse: boolean };

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
  // Exhaustive over SceneObject.kind — enforced by
  // `@typescript-eslint/switch-exhaustiveness-check`. The default arm's
  // assertNever turns missing arms into compile errors when a new
  // variant lands (per ADR-014).
  switch (obj.kind) {
    case 'imported-svg':
      appendPathSegments(obj.paths, obj.transform, layer, device, out);
      return;
    case 'text':
      appendPathSegments(obj.paths, obj.transform, layer, device, out);
      return;
    case 'traced-image':
      appendPathSegments(obj.paths, obj.transform, layer, device, out);
      return;
    case 'shape':
      appendPathSegments(obj.paths, obj.transform, layer, device, out);
      return;
    case 'raster-image':
      // F.2.c: SceneObject union now includes raster-image. The
      // dedicated raster emit path (compileRasterGroup → emitRaster)
      // lands in F.2.d; for this commit, raster images don't
      // contribute polyline segments and the compile path skips
      // them. Behaviour parity with the F.2.b standalone emit-raster
      // tests preserved.
      return;
    case 'relief':
      // CNC-only geometry — the laser compiler never emits it.
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
      appendFillPathContours(obj.paths, obj.transform, layer, device, out);
      return;
    case 'text':
      appendFillPathContours(obj.paths, obj.transform, layer, device, out);
      return;
    case 'traced-image':
      appendFillPathContours(obj.paths, obj.transform, layer, device, out);
      return;
    case 'shape':
      appendFillPathContours(obj.paths, obj.transform, layer, device, out);
      return;
    case 'raster-image':
    case 'relief':
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
    for (const polyline of compilationPolylines(path)) {
      out.push({
        points: polyline.points.map((p) => toMachineCoords(applyTransform(p, transform), device)),
        closed: polyline.closed,
      });
    }
  }
}

// Shared materializer for any SceneObject whose paths are already
// available as ColoredPath polylines (ImportedSvg, TextObject,
// TracedImage). The switch above stays one-arm-per-kind for
// exhaustiveness, but each arm just delegates here — no duplicated
// coordinate-transform math.
//
// Line mode transforms source contours directly. Fill mode uses the
// layer-wide machine-space path above so hatch spacing is physical and
// same-layer contours interact before hatching.
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
    for (const polyline of compilationPolylines(path)) {
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, transform), device),
      );
      if (shouldApplyKerf(polyline, layer)) {
        closedForKerf.push({ points, closed: true });
      } else {
        // Enforce the CutSegment invariant "a closed segment's last point
        // equals its first" so the emitter (which walks points and ignores the
        // `closed` flag) draws the closing edge. DXF entities drop the seam
        // vertex, which otherwise left the final edge uncut.
        out.push({ polyline: withClosingPoint(points, polyline.closed), closed: polyline.closed });
      }
    }
    for (const offset of offsetClosedPolylinesForKerf(closedForKerf, layer.kerfOffsetMm)) {
      out.push({ polyline: offset.points, closed: true });
    }
  }
}

function compilationPolylines(path: ColoredPath): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: 100_000,
  });
  // Normal output reaches this only after the matching pre-emit budget check.
  // Direct pure-core callers retain the compatibility view on over-budget data.
  return flattened.kind === 'ok' ? flattened.polylines : path.polylines;
}

function shouldApplyKerf(polyline: Polyline, layer: Layer): boolean {
  return layer.mode === 'line' && layer.kerfOffsetMm !== 0 && polyline.closed;
}
