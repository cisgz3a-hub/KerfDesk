// layer-fill — materializes a fill-mode Layer into fill segments and island
// fill Groups. Split out of compile-job (which owns the Scene → Job walk and
// the line path) so each file has one responsibility and stays inside the
// file-size cap. Pure: no clock, no random, no I/O.

import { type DeviceProfile, toMachineCoords } from '../devices';
import {
  applyTransform,
  assertNever,
  type ColoredPath,
  type Layer,
  pathUsesOperation,
  type Polyline,
  type SceneObject,
} from '../scene';
import { compilationPolylines } from './compilation-polylines';
import { memoizedFillHatchingWithMetadata } from './fill-hatching-cache';
import { fillRuleForLayer, layerFillCacheKey } from './fill-rule';
import { fillRunwayPolicyForDevice } from './fill-runway-policy';
import { groupFillContoursIntoIslands } from './island-fill';
import { islandFillMotionPolicyForDevice } from './island-fill-motion';
import type { FillSegment, Group } from './job';
import { offsetFillContours } from './offset-fill';
import type { OffsetFillTermination } from './offset-fill-termination';
import { resolveIslandFillScanDirection } from './scan-direction-policy';
import { validatedScanOffsetMm } from './scan-offset';
import { commonVectorGroupFields } from './vector-group-fields';

const MAX_LAYER_FILL_CACHE_ENTRIES = 8;

type FillSegmentAsPolyline = Polyline & { readonly reverse: boolean };

// Allowed module-level cache (narrow exception to "no module-level mutable") —
// see ADR-050. Identity-keyed via WeakMap (GC-bounded), output-invariant, inner
// map capped at MAX_LAYER_FILL_CACHE_ENTRIES, pinned by compile-job-fill-cache.test.ts.
const layerFillCache = new WeakMap<
  ReadonlyArray<SceneObject>,
  Map<string, ReadonlyArray<FillSegmentAsPolyline>>
>();

export function islandFillGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
  sourceObjectId?: string,
): Group[] {
  const common = commonVectorGroupFields(layer, device, powerSource, sourceObjectId);
  const fillRule = fillRuleForLayer(objects, layer);
  const contours = collectFillContoursForLayer(objects, layer, device);
  const islandMotionPolicy = islandFillMotionPolicyForDevice(device);
  const sensitiveIslandFill = islandMotionPolicy === 'sensitive';
  const scanDirection = resolveIslandFillScanDirection(device, layer, sensitiveIslandFill);
  const hatchingLayer = { ...layer, fillBidirectional: scanDirection.bidirectional };
  const bidirectionalScanOffsetMm = validatedScanOffsetMm(device, layer.bidirectionalScanOffsetMm);
  const fillRunwayPolicy = fillRunwayPolicyForDevice(device, 'island');
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
        ...(fillRunwayPolicy === undefined ? {} : { fillRunwayPolicy }),
        scanDirection,
        ...(bidirectionalScanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm }),
        overscanMm: Math.max(0, layer.fillOverscanMm),
        segments,
      },
    ];
  });
}

export type LayerFillSegments = {
  readonly segments: FillSegment[];
  // Records natural completion separately from geometry-engine failure and
  // pass-budget exhaustion. Absent for non-offset hatch fills.
  readonly offsetFillTermination?: OffsetFillTermination;
};

export function collectFillSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): LayerFillSegments {
  const offsetFill =
    layer.fillStyle === 'offset'
      ? offsetFillContours({
          polylines: collectFillContoursForLayer(objects, layer, device),
          spacingMm: layer.hatchSpacingMm,
        })
      : null;
  const polylines =
    offsetFill === null
      ? memoizedLayerFillHatching(objects, layer, device)
      : offsetFill.contours.map((polyline) => ({ ...polyline, reverse: false }));
  return {
    segments: polylines.map((polyline) => ({
      polyline: polyline.points,
      closed: polyline.closed,
      reverse: polyline.reverse,
    })),
    ...(offsetFill === null ? {} : { offsetFillTermination: offsetFill.termination }),
  };
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

function appendFillContoursFromObject(
  obj: SceneObject,
  layer: Layer,
  device: DeviceProfile,
  out: Polyline[],
): void {
  switch (obj.kind) {
    case 'imported-svg':
      appendFillPathContours(obj, layer, device, out);
      return;
    case 'text':
      appendFillPathContours(obj, layer, device, out);
      return;
    case 'traced-image':
      appendFillPathContours(obj, layer, device, out);
      return;
    case 'shape':
      appendFillPathContours(obj, layer, device, out);
      return;
    case 'raster-image':
    case 'relief':
      return;
    default:
      assertNever(obj, 'SceneObject');
  }
}

function appendFillPathContours(
  object: Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>,
  layer: Layer,
  device: DeviceProfile,
  out: Polyline[],
): void {
  for (const path of object.paths) {
    if (!pathUsesOperation(object, path, layer)) continue;
    for (const polyline of compilationPolylines(path)) {
      out.push({
        points: polyline.points.map((p) =>
          toMachineCoords(applyTransform(p, object.transform), device),
        ),
        closed: polyline.closed,
      });
    }
  }
}
