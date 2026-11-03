// World contours of Fill pools (ADR-683). A member's region is placed in world
// millimetres once per object and contour set, so a drag step re-places only
// the member that moved (Amendment 3), and a pool's contour array keeps its
// identity while every member is the same, which keys its sprite and raster.

import { applyTransform, type Polyline } from '../../core/scene';
import { countPolylineSegments } from './draw-complexity';
import type { VectorSceneObject } from './object-display';

export type PlacedRegion = {
  /** Object-space contours whose even-odd parity is the member's own region. */
  readonly source: ReadonlyArray<Polyline>;
  readonly contours: ReadonlyArray<Polyline>;
  readonly segmentCount: number;
};

export type PoolGeometry = {
  readonly objects: ReadonlyArray<VectorSceneObject>;
  /** Each member's region in world millimetres, in cluster order. */
  readonly regions: ReadonlyArray<PlacedRegion>;
  readonly contours: ReadonlyArray<Polyline>;
  readonly segmentCount: number;
};

// By object, then by contour set: an object on two Fill operations brings a
// different set of paths to each pool.
const placedRegions = new WeakMap<VectorSceneObject, WeakMap<object, PlacedRegion>>();

/** A member's region in world millimetres; recomputed only when it moves or changes shape. */
export function placedRegion(
  object: VectorSceneObject,
  source: ReadonlyArray<Polyline>,
): PlacedRegion {
  const bySource = placedRegions.get(object) ?? new WeakMap<object, PlacedRegion>();
  const cached = bySource.get(source);
  if (cached !== undefined) return cached;
  const contours = source.map((contour) => ({
    closed: true,
    points: contour.points.map((point) => applyTransform(point, object.transform)),
  }));
  const placed = { source, contours, segmentCount: countPolylineSegments(contours) };
  bySource.set(source, placed);
  placedRegions.set(object, bySource);
  return placed;
}

const poolGeometryCache = new WeakMap<VectorSceneObject, Map<string, PoolGeometry>>();

/** The world contours of one cluster, the same arrays while its members are. */
export function poolGeometry(
  key: string,
  objects: ReadonlyArray<VectorSceneObject>,
  sources: ReadonlyArray<ReadonlyArray<Polyline>>,
): PoolGeometry {
  const first = objects[0] as VectorSceneObject;
  const byKey = poolGeometryCache.get(first) ?? new Map<string, PoolGeometry>();
  const cached = byKey.get(key);
  if (
    cached !== undefined &&
    cached.objects.length === objects.length &&
    cached.objects.every(
      (object, i) => object === objects[i] && cached.regions[i]?.source === sources[i],
    )
  ) {
    return cached;
  }
  const regions = objects.map((object, i) => placedRegion(object, sources[i] ?? []));
  let segmentCount = 0;
  for (const region of regions) segmentCount += region.segmentCount;
  const geometry = {
    objects: [...objects],
    regions,
    contours: regions.flatMap((region) => region.contours),
    segmentCount,
  };
  byKey.set(key, geometry);
  poolGeometryCache.set(first, byKey);
  return geometry;
}
