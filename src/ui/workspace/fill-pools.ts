// Fill pools (ADR-683): the canvas paints a Fill operation the way it burns.
//
// The compiler resolves each object on a Fill operation by its own paths'
// rules (non-zero for text), unions that object's paths, and then hatches all
// of the operation's objects together under even-odd parity (layer-fill.ts,
// fill-rule.ts, ADR-486 Amendment 2). A shape drawn inside another object is
// therefore a hole, and two stacked copies cancel and burn nothing, as in
// LightBurn. Painting each object as its own fill showed both as solid.
//
// A filled path joins the pool of every visible Fill operation it is bound to
// (Add operation binds a second one), as each burns it (Amendment 1).
// Only objects whose boxes overlap can change one another's parity, so each
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
  normalizeClosedPolylinesEvenOddChecked,
  normalizeClosedPolylinesNonZeroChecked,
} from '../../core/geometry/polygon-difference';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  isRegistrationBox,
  transformedBBox,
  type AABB,
  type Polyline,
  type SceneObject,
} from '../../core/scene';
import { drawArtworkSprite, SPRITE_MIN_DISPLAY_SEGMENTS } from './artwork-sprite-cache';
import { artworkStrokeWidthPx, countPolylineSegments } from './draw-complexity';
import type { DisplayPolylines } from './display-polylines';
import {
  clipClosedPolylines,
  fillClosedPolylinesBatched,
  strokePolylinesBatched,
} from './draw-vector-strokes';
import { overlappingGroups } from './fill-pool-clusters';
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
  /** Some path of it also burns under another Fill operation. */
  shared: boolean;
};

type PoolMembers = { readonly color: string; readonly output: boolean; readonly members: Member[] };

const NO_POOLS: ReadonlyArray<FillPool> = [];
const WORLD = { transform: IDENTITY_TRANSFORM };
const NOTHING_ELSE_DRAWN = (): AABB | null => null;
// A pool split into many parts is clipped once per part. Past this many
// clipped segments a frame it is painted whole at its highest member instead,
// over the artwork between, so nothing it burns is hidden.
const CLIP_BUDGET_SEGMENTS = 1_000_000;

/**
 * Plan the pools for resolved vectors in drawing order (undefined: no vector
 * drawn there). `drawnBox` is the box of anything else an index draws (a
 * photo), or null.
 */
export function planFillPools(
  entries: ReadonlyArray<ResolvedVector | undefined>,
  drawnBox: (index: number) => AABB | null = NOTHING_ELSE_DRAWN,
): FillPoolPlan {
  const poolsAt = new Map<number, FillPool[]>();
  const pooledPaths = new Map<number, Set<number>>();
  const boxAt = drawnBoxes(entries, drawnBox);
  for (const [key, pool] of poolMembers(entries)) {
    for (const cluster of clustersOf(key, pool.members)) {
      if (cluster.length < 2 && !cluster.some((member) => member.shared)) continue;
      for (const [index, part] of poolParts(key, pool, cluster, boxAt)) {
        poolsAt.set(index, [...(poolsAt.get(index) ?? []), part]);
      }
      for (const member of cluster) {
        const indexes = pooledPaths.get(member.index) ?? new Set<number>();
        for (const pathIndex of member.pathIndexes) indexes.add(pathIndex);
        pooledPaths.set(member.index, indexes);
      }
    }
  }
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
): void {
  const plan = planFillPools(entries);
  entries.forEach((entry, index) => {
    for (const pool of plan.poolsAt(index)) paintFillPool(ctx, pool, view);
    const display = plan.displayAt(index);
    if (display !== undefined && display.paths.length > 0) paintObject(entry.object, display);
  });
}

// Every filled path with closed contours, under each Fill operation that burns
// it, by the colour and output it paints with: a pool holds paths that paint alike.
function poolMembers(entries: ReadonlyArray<ResolvedVector | undefined>): Map<string, PoolMembers> {
  const pools = new Map<string, PoolMembers>();
  entries.forEach((entry, index) => {
    if (entry === undefined || isRegistrationBox(entry.object)) return;
    entry.display.paths.forEach((path, pathIndex) => {
      if (path.paint.kind !== 'fill') return;
      if (!path.display.polylines.some((polyline) => polyline.closed)) return;
      for (const { operationId, color, output } of path.fillOperations) {
        const key = `${operationId}\n${color}\n${output ? 1 : 0}`;
        const pool = pools.get(key) ?? { color, output, members: [] };
        let member = pool.members.at(-1);
        if (member?.index !== index) {
          const box = vectorObjectWorldBounds(entry.object);
          if (box === null) return;
          member = { index, object: entry.object, paths: [], pathIndexes: [], box, shared: false };
          pool.members.push(member);
          pools.set(key, pool);
        }
        member.paths.push(path);
        member.pathIndexes.push(pathIndex);
        member.shared ||= path.fillOperations.length > 1;
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
  boxAt: (index: number) => AABB | null,
): Array<readonly [number, FillPool]> {
  const geometry = poolGeometry(key, cluster);
  const whole: FillPool = {
    color: pool.color,
    widthPx: artworkStrokeWidthPx(geometry.segmentCount, pool.output),
    contours: geometry.contours,
    segmentCount: geometry.segmentCount,
    memberIds: cluster.map((member) => member.object.id),
  };
  const parts = splitWhereCovered(cluster, boxAt);
  if (parts.length === 1) return [[(cluster[0] as Member).index, whole]];
  if (parts.length * geometry.segmentCount > CLIP_BUDGET_SEGMENTS) {
    return [[(cluster.at(-1) as Member).index, whole]];
  }
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
// the cluster separates.
function splitWhereCovered(
  cluster: ReadonlyArray<Member>,
  boxAt: (index: number) => AABB | null,
): number[][] {
  const box = unionBox(cluster);
  const parts: number[][] = [[0]];
  for (let position = 1; position < cluster.length; position += 1) {
    const below = (cluster[position - 1] as Member).index;
    const index = (cluster[position] as Member).index;
    let covered = false;
    for (let between = below + 1; between < index && !covered; between += 1) {
      const drawn = boxAt(between);
      covered = drawn !== null && boxesOverlap(drawn, box);
    }
    if (covered) parts.push([]);
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
  const parts = cluster.map((member) => [member.object, memberParityContours(member)] as const);
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

// Object-space contours whose even-odd parity is this member's own region:
// its single even-odd path as drawn, or else each path resolved by its rule
// and the paths unioned, exactly as layer-fill.ts burns one object.
const closedCache = new WeakMap<DisplayPolylines, ReadonlyArray<Polyline>>();
const resolvedCache = new WeakMap<
  DisplayPolylines,
  {
    readonly displays: ReadonlyArray<DisplayPolylines>;
    readonly rules: string;
    readonly contours: ReadonlyArray<Polyline>;
  }
>();

function memberParityContours(member: Member): ReadonlyArray<Polyline> {
  const [only, ...others] = member.paths;
  if (only === undefined) return [];
  const rules = member.paths.map(fillRuleOf).join(',');
  if (others.length === 0 && rules === 'evenodd') return closedContours(only.display);
  const displays = member.paths.map((path) => path.display);
  const cached = resolvedCache.get(only.display);
  if (
    cached !== undefined &&
    cached.rules === rules &&
    cached.displays.length === displays.length &&
    cached.displays.every((display, i) => display === displays[i])
  ) {
    return cached.contours;
  }
  const contours = resolvedRegion(member.paths);
  resolvedCache.set(only.display, { displays, rules, contours });
  return contours;
}

function fillRuleOf(path: PathDisplay): CanvasFillRule {
  return path.paint.kind === 'fill' ? path.paint.fillRule : 'evenodd';
}

function resolvedRegion(paths: ReadonlyArray<PathDisplay>): ReadonlyArray<Polyline> {
  const batches: Polyline[] = [];
  for (const path of paths) {
    const closed = closedContours(path.display);
    const resolved =
      fillRuleOf(path) === 'nonzero'
        ? normalizeClosedPolylinesNonZeroChecked(closed)
        : normalizeClosedPolylinesEvenOddChecked(closed);
    // The compiler falls back to the raw contours under even-odd as well.
    if (resolved.kind === 'error') return paths.flatMap((each) => closedContours(each.display));
    for (const contour of resolved.value) batches.push(contour);
  }
  const union = normalizeClosedPolylinesNonZeroChecked(batches);
  return union.kind === 'ok' ? union.value : batches;
}

function closedContours(display: DisplayPolylines): ReadonlyArray<Polyline> {
  const cached = closedCache.get(display);
  if (cached !== undefined) return cached;
  const closed = display.polylines.filter((polyline) => polyline.closed);
  closedCache.set(display, closed);
  return closed;
}

function withoutPooledFills(display: ObjectDisplay, pooled: ReadonlySet<number>): ObjectDisplay {
  const paths = display.paths.flatMap((path, index) => {
    if (!pooled.has(index)) return [path];
    const open = path.display.polylines.filter((polyline) => !polyline.closed);
    return open.length === 0 ? [] : [{ ...path, display: { ...path.display, polylines: open } }];
  });
  return { ...display, paths, styleKey: `${display.styleKey}|pooled:${[...pooled].join(',')}` };
}

function boxesOverlap(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
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
