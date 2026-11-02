// Fill pools (ADR-683): the canvas paints a Fill operation the way it burns.
//
// The compiler resolves each object on a Fill operation by its own paths'
// rules (non-zero for text), unions that object's paths, and then hatches all
// of the operation's objects together under even-odd parity (layer-fill.ts,
// fill-rule.ts, ADR-486 Amendment 2). A shape drawn inside another object is
// therefore a hole, and two stacked copies cancel and burn nothing, as in
// LightBurn. Painting each object as its own fill showed both as solid.
//
// Who is in a pool is what output does (fill-operations.ts, Amendment 2): a path
// joins the pool of every visible Fill operation it burns under, wherever that
// binding comes in its list (Add operation binds a second one), and a pool holds
// one compile run's objects. A path drawn as a stroke keeps its stroke, and its
// pools fill it as well. Only objects whose boxes overlap can change one another's parity, so each
// operation's objects are split into overlapping clusters. A lone object on
// one operation keeps painting itself (and its sprite); any other cluster is
// painted as one even-odd region where its lowest member sits in the drawing
// order. If other artwork drawn between two members overlaps it (a photo in a
// frame, under a caption), it is painted in parts split there instead: each
// part where its lowest member sits, its members' own regions clipped to the
// pool's region, so every member keeps its place in the drawing order.
// Members still paint their open contours and any other operation's paths
// themselves, and keep their own selection and hover; the hit test counts the
// same pools (core/scene/hit-test.ts).

import {
  applyTransform,
  IDENTITY_TRANSFORM,
  isRegistrationBox,
  transformedBBox,
  type AABB,
  type Polyline,
  type SceneObject,
} from '../../core/scene';
import { ONE_FILL_POOL_RUN, type FillPoolRuns } from '../../core/scene/fill-operations';
import { drawArtworkSprite, SPRITE_MIN_DISPLAY_SEGMENTS } from './artwork-sprite-cache';
import { artworkStrokeWidthPx, countPolylineSegments } from './draw-complexity';
import {
  clipClosedPolylines,
  fillClosedPolylinesBatched,
  strokePolylinesBatched,
} from './draw-vector-strokes';
import { drawnOverClusters, overlappingGroups } from './fill-pool-clusters';
import { parityContours } from './fill-pool-regions';
import type { ObjectDisplay, PathDisplay, VectorSceneObject } from './object-display';
import { vectorObjectWorldBounds } from './object-viewport';
import type { ViewTransform } from './view-transform';

export type ResolvedVector = {
  readonly object: VectorSceneObject;
  readonly display: ObjectDisplay;
};

export type FillPool = {
  readonly color: string;
  readonly widthPx: number;
  /** World-millimetre closed contours; their even-odd parity is what burns. */
  readonly contours: ReadonlyArray<Polyline>;
  readonly segmentCount: number;
  readonly memberIds: ReadonlyArray<string>;
  /** One part of a split pool: these members' world regions, clipped to `contours`. */
  readonly regions?: ReadonlyArray<ReadonlyArray<Polyline>>;
};

export type FillPoolPlan = {
  /** Pools, or parts of them, painted just before the object at this index. */
  readonly poolsAt: (index: number) => ReadonlyArray<FillPool>;
  /** The object's display, less the closed fills a pool paints for it. */
  readonly displayAt: (index: number) => ObjectDisplay | undefined;
};

type Member = {
  readonly index: number;
  readonly object: VectorSceneObject;
  readonly paths: PathDisplay[];
  readonly pathIndexes: number[];
  readonly box: AABB;
  /** Some path of it needs a pool even alone: it burns under another Fill operation
   *  too, or the object draws it as a stroke. */
  poolsAlone: boolean;
};

type PoolMembers = { readonly color: string; readonly output: boolean; readonly members: Member[] };

const NO_POOLS: ReadonlyArray<FillPool> = [];
const WORLD = { transform: IDENTITY_TRANSFORM };
const NOTHING_ELSE_DRAWN = (): AABB | null => null;

type PoolCluster = {
  readonly key: string;
  readonly pool: PoolMembers;
  readonly cluster: ReadonlyArray<Member>;
};
// A pool split into many parts is clipped once per part. A pool that would take
// a frame past this many clipped segments is painted whole at its highest member
// instead, over the artwork between, so nothing it burns is hidden.
const CLIP_BUDGET_SEGMENTS = 1_000_000;

/**
 * Plan the pools for resolved vectors in drawing order (undefined: no vector
 * drawn there). `drawnBox` is the box of anything else an index draws (a
 * photo), or null. `runOf` is an object's compile run (`fillPoolRuns`).
 */
export function planFillPools(
  entries: ReadonlyArray<ResolvedVector | undefined>,
  drawnBox: (index: number) => AABB | null = NOTHING_ELSE_DRAWN,
  runOf: FillPoolRuns = ONE_FILL_POOL_RUN,
): FillPoolPlan {
  const poolsAt = new Map<number, FillPool[]>();
  const pooledPaths = new Map<number, Set<number>>();
  const clusters: PoolCluster[] = [];
  for (const [key, pool] of poolMembers(entries, runOf)) {
    for (const cluster of clustersOf(key, pool.members)) {
      if (cluster.length >= 2 || cluster.some((member) => member.poolsAlone)) {
        clusters.push({ key, pool, cluster });
      }
    }
  }
  const covering = drawnOverClusters(
    clusters.map(({ cluster }) => ({
      indexes: cluster.map((member) => member.index),
      box: unionBox(cluster),
    })),
    entries.length,
    drawnBoxes(entries, drawnBox),
  );
  const clipBudget = { segments: CLIP_BUDGET_SEGMENTS };
  clusters.forEach(({ key, pool, cluster }, position) => {
    const parts = poolParts(key, pool, cluster, covering[position] as number[], clipBudget);
    for (const [index, part] of parts) {
      poolsAt.set(index, [...(poolsAt.get(index) ?? []), part]);
    }
    for (const member of cluster) {
      const indexes = pooledPaths.get(member.index) ?? new Set<number>();
      for (const pathIndex of member.pathIndexes) indexes.add(pathIndex);
      pooledPaths.set(member.index, indexes);
    }
  });
  return {
    poolsAt: (index) => poolsAt.get(index) ?? NO_POOLS,
    displayAt: (index) => {
      const display = entries[index]?.display;
      const pooled = pooledPaths.get(index);
      return display === undefined || pooled === undefined
        ? display
        : withoutPooledFills(display, pooled);
    },
  };
}

/** The box a photo or relief covers when it is drawn, for `planFillPools`. */
export function drawnBitmapBox(object: SceneObject | undefined, onCanvas: boolean): AABB | null {
  return onCanvas && (object?.kind === 'raster-image' || object?.kind === 'relief')
    ? transformedBBox(object)
    : null;
}

/** Draw the pools queued before one object; `alphaFor` dims one out of focus. */
export function drawFillPools(
  ctx: CanvasRenderingContext2D,
  pools: ReadonlyArray<FillPool>,
  view: ViewTransform,
  alphaFor: (memberIds: ReadonlyArray<string>) => number | null,
  requestRedraw?: () => void,
): void {
  for (const pool of pools) {
    ctx.save();
    const alpha = alphaFor(pool.memberIds);
    if (alpha !== null) ctx.globalAlpha = alpha;
    drawFillPool(ctx, pool, view, requestRedraw);
    ctx.restore();
  }
}

/** Draw a pool, from a cached sprite when it is whole and as dense as a sprited object. */
export function drawFillPool(
  ctx: CanvasRenderingContext2D,
  pool: FillPool,
  view: ViewTransform,
  requestRedraw?: () => void,
): void {
  if (
    pool.regions === undefined &&
    pool.segmentCount >= SPRITE_MIN_DISPLAY_SEGMENTS &&
    drawArtworkSprite({
      ctx,
      key: pool.contours,
      transform: IDENTITY_TRANSFORM,
      view,
      styleKey: `pool|${pool.color}|${pool.widthPx}`,
      measure: () => contoursBounds(pool.contours),
      paint: (spriteCtx, spriteView) => paintFillPool(spriteCtx, pool, spriteView),
      requestRedraw,
    })
  ) {
    return;
  }
  paintFillPool(ctx, pool, view);
}

export function paintFillPool(
  ctx: CanvasRenderingContext2D,
  pool: FillPool,
  view: ViewTransform,
): void {
  ctx.fillStyle = pool.color;
  // Every contour of an even-odd region is one of its edges, so this outline
  // only shows where copies cancel: LightBurn draws them unfilled, not gone.
  ctx.strokeStyle = pool.color;
  ctx.lineWidth = pool.widthPx;
  if (pool.regions === undefined) {
    fillClosedPolylinesBatched(ctx, WORLD, pool.contours, view, 'evenodd');
    strokePolylinesBatched(ctx, WORLD, pool.contours, view);
    return;
  }
  ctx.save();
  clipClosedPolylines(ctx, WORLD, pool.contours, view, 'evenodd');
  for (const region of pool.regions) fillClosedPolylinesBatched(ctx, WORLD, region, view);
  ctx.restore();
  for (const region of pool.regions) strokePolylinesBatched(ctx, WORLD, region, view);
}

/** Paint resolved vectors in order with their Fill operations pooled (no sprites). */
export function paintPooledObjectDisplays(
  ctx: CanvasRenderingContext2D,
  entries: ReadonlyArray<ResolvedVector>,
  view: ViewTransform,
  paintObject: (object: VectorSceneObject, display: ObjectDisplay) => void,
  runOf: FillPoolRuns = ONE_FILL_POOL_RUN,
): void {
  const plan = planFillPools(entries, NOTHING_ELSE_DRAWN, runOf);
  entries.forEach((entry, index) => {
    for (const pool of plan.poolsAt(index)) paintFillPool(ctx, pool, view);
    const display = plan.displayAt(index);
    if (display !== undefined && display.paths.length > 0) paintObject(entry.object, display);
  });
}

// Every path with closed contours, under each Fill operation that burns it, by
// its compile run and the colour and output it paints with: a pool holds paths
// that burn together and paint alike.
function poolMembers(
  entries: ReadonlyArray<ResolvedVector | undefined>,
  runOf: FillPoolRuns,
): Map<string, PoolMembers> {
  const pools = new Map<string, PoolMembers>();
  entries.forEach((entry, index) => {
    if (entry === undefined || isRegistrationBox(entry.object)) return;
    const run = runOf(entry.object);
    entry.display.paths.forEach((path, pathIndex) => {
      if (!path.fillDisplay.polylines.some((polyline) => polyline.closed)) return;
      for (const { operationId, color, output } of path.fillOperations) {
        const key = `${run}\n${operationId}\n${color}\n${output ? 1 : 0}`;
        const pool = pools.get(key) ?? { color, output, members: [] };
        let member = pool.members.at(-1);
        if (member?.index !== index) {
          const box = vectorObjectWorldBounds(entry.object);
          if (box === null) return;
          member = {
            index,
            object: entry.object,
            paths: [],
            pathIndexes: [],
            box,
            poolsAlone: false,
          };
          pool.members.push(member);
          pools.set(key, pool);
        }
        member.paths.push(path);
        member.pathIndexes.push(pathIndex);
        member.poolsAlone ||= path.fillOperations.length > 1 || path.paint.kind !== 'fill';
      }
    });
  });
  return pools;
}

// Each operation's overlap groups are kept while its members are the same
// objects, so a still frame does not sweep a dense cluster again (N6-P3-3).
type ClusterGroups = {
  readonly objects: ReadonlyArray<VectorSceneObject>;
  readonly groups: ReadonlyArray<ReadonlyArray<number>>;
};
const clusterCache = new WeakMap<VectorSceneObject, Map<string, ClusterGroups>>();

function clustersOf(key: string, members: ReadonlyArray<Member>): Member[][] {
  const first = (members[0] as Member).object;
  const byKey = clusterCache.get(first) ?? new Map<string, ClusterGroups>();
  const cached = byKey.get(key);
  let groups = cached?.groups;
  if (
    groups === undefined ||
    cached?.objects.length !== members.length ||
    cached.objects.some((object, i) => object !== members[i]?.object)
  ) {
    groups = overlappingGroups(members.map((member) => member.box));
    byKey.set(key, { objects: members.map((member) => member.object), groups });
    clusterCache.set(first, byKey);
  }
  return groups.map((group) => group.map((position) => members[position] as Member));
}

// Where a cluster's pool is painted: whole at its lowest member, or in parts
// split wherever artwork drawn between two members overlaps the cluster.
function poolParts(
  key: string,
  pool: PoolMembers,
  cluster: ReadonlyArray<Member>,
  covering: ReadonlyArray<number>,
  clipBudget: { segments: number },
): Array<readonly [number, FillPool]> {
  const geometry = poolGeometry(key, cluster);
  const whole: FillPool = {
    color: pool.color,
    widthPx: artworkStrokeWidthPx(geometry.segmentCount, pool.output),
    contours: geometry.contours,
    segmentCount: geometry.segmentCount,
    memberIds: cluster.map((member) => member.object.id),
  };
  const parts = splitWhereCovered(cluster, covering);
  if (parts.length === 1) return [[(cluster[0] as Member).index, whole]];
  const clipped = parts.length * geometry.segmentCount;
  if (clipped > clipBudget.segments) return [[(cluster.at(-1) as Member).index, whole]];
  clipBudget.segments -= clipped;
  return parts.map((part) => [
    (cluster[part[0] as number] as Member).index,
    {
      ...whole,
      memberIds: part.map((position) => (cluster[position] as Member).object.id),
      regions: part.map((position) => geometry.regions[position] ?? []),
    },
  ]);
}

// Positions in the cluster, in runs that no other drawn artwork overlapping
// the cluster (`covering`, ascending drawing indexes) separates.
function splitWhereCovered(
  cluster: ReadonlyArray<Member>,
  covering: ReadonlyArray<number>,
): number[][] {
  const parts: number[][] = [[0]];
  let next = 0;
  for (let position = 1; position < cluster.length; position += 1) {
    const below = (cluster[position - 1] as Member).index;
    const index = (cluster[position] as Member).index;
    while ((covering[next] ?? Number.POSITIVE_INFINITY) <= below) next += 1;
    if ((covering[next] ?? Number.POSITIVE_INFINITY) < index) parts.push([]);
    parts.at(-1)?.push(position);
  }
  return parts;
}

function drawnBoxes(
  entries: ReadonlyArray<ResolvedVector | undefined>,
  drawnBox: (index: number) => AABB | null,
): (index: number) => AABB | null {
  const boxes = new Map<number, AABB | null>();
  return (index) => {
    let box = boxes.get(index);
    if (box === undefined) {
      const entry = entries[index];
      box = entry === undefined ? drawnBox(index) : vectorObjectWorldBounds(entry.object);
      boxes.set(index, box);
    }
    return box;
  };
}

type PoolGeometry = {
  readonly parts: ReadonlyArray<readonly [VectorSceneObject, ReadonlyArray<Polyline>]>;
  /** Each member's region in world millimetres, in cluster order. */
  readonly regions: ReadonlyArray<ReadonlyArray<Polyline>>;
  readonly contours: ReadonlyArray<Polyline>;
  readonly segmentCount: number;
};

// A pool's world contours are rebuilt only when one of its members changes.
const poolGeometryCache = new WeakMap<VectorSceneObject, Map<string, PoolGeometry>>();

function poolGeometry(key: string, cluster: ReadonlyArray<Member>): PoolGeometry {
  const first = (cluster[0] as Member).object;
  const parts = cluster.map((member) => [member.object, parityContours(member.paths)] as const);
  const byKey = poolGeometryCache.get(first) ?? new Map<string, PoolGeometry>();
  const cached = byKey.get(key);
  if (
    cached !== undefined &&
    cached.parts.length === parts.length &&
    cached.parts.every(
      ([object, contours], i) => object === parts[i]?.[0] && contours === parts[i]?.[1],
    )
  ) {
    return cached;
  }
  const regions = parts.map(([object, contours]) =>
    contours.map((contour) => ({
      closed: true,
      points: contour.points.map((point) => applyTransform(point, object.transform)),
    })),
  );
  const contours = regions.flat();
  const geometry = { parts, regions, contours, segmentCount: countPolylineSegments(contours) };
  byKey.set(key, geometry);
  poolGeometryCache.set(first, byKey);
  return geometry;
}

function withoutPooledFills(display: ObjectDisplay, pooled: ReadonlySet<number>): ObjectDisplay {
  const paths = display.paths.flatMap((path, index) => {
    // A stroke stays a stroke: only its fill went into the pool.
    if (!pooled.has(index) || path.paint.kind !== 'fill') return [path];
    const open = path.display.polylines.filter((polyline) => !polyline.closed);
    return open.length === 0 ? [] : [{ ...path, display: { ...path.display, polylines: open } }];
  });
  return { ...display, paths, styleKey: `${display.styleKey}|pooled:${[...pooled].join(',')}` };
}

function unionBox(members: ReadonlyArray<Member>): AABB {
  let { minX, minY, maxX, maxY } = (members[0] as Member).box;
  for (const { box } of members) {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function contoursBounds(contours: ReadonlyArray<Polyline>): AABB {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const contour of contours) {
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}
