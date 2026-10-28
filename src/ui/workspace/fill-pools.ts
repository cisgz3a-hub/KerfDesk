// Fill pools (ADR-683): the canvas paints a Fill operation the way it burns.
//
// The compiler resolves each object on a Fill operation by its own paths'
// rules (non-zero for text), unions that object's paths, and then hatches all
// of the operation's objects together under even-odd parity (layer-fill.ts,
// fill-rule.ts, ADR-486 Amendment 2). A shape drawn inside another object is
// therefore a hole, and two stacked copies cancel and burn nothing, as in
// LightBurn. Painting each object as its own fill showed both as solid.
//
// Only objects whose boxes overlap can change one another's parity, so each
// operation's objects are split into overlapping clusters. A lone object keeps
// painting itself (and its sprite); a cluster of two or more is painted once,
// as one even-odd region, where its lowest member sits in the drawing order.
// Its members still paint their open contours and any other operation's paths
// themselves, and keep their own selection, hover and hit test.

import {
  normalizeClosedPolylinesEvenOddChecked,
  normalizeClosedPolylinesNonZeroChecked,
} from '../../core/geometry/polygon-difference';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  isRegistrationBox,
  type AABB,
  type Polyline,
} from '../../core/scene';
import { drawArtworkSprite, SPRITE_MIN_DISPLAY_SEGMENTS } from './artwork-sprite-cache';
import { artworkStrokeWidthPx, countPolylineSegments } from './draw-complexity';
import type { DisplayPolylines } from './display-polylines';
import { fillClosedPolylinesBatched, strokePolylinesBatched } from './draw-vector-strokes';
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
};

export type FillPoolPlan = {
  /** Pools painted just before the object at this index, their lowest member. */
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
};

const NO_POOLS: ReadonlyArray<FillPool> = [];
const WORLD = { transform: IDENTITY_TRANSFORM };

/** Plan the pools for resolved vectors in drawing order (undefined: not drawn). */
export function planFillPools(entries: ReadonlyArray<ResolvedVector | undefined>): FillPoolPlan {
  const poolsAt = new Map<number, FillPool[]>();
  const pooledPaths = new Map<number, Set<number>>();
  for (const members of operationMembers(entries).values()) {
    if (members.length < 2) continue;
    for (const cluster of overlappingClusters(members)) {
      const first = cluster[0];
      if (cluster.length < 2 || first === undefined) continue;
      const pools = poolsAt.get(first.index) ?? [];
      pools.push(buildPool(cluster));
      poolsAt.set(first.index, pools);
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

/** Draw a pool, from a cached sprite when it is as dense as a sprited object. */
export function drawFillPool(
  ctx: CanvasRenderingContext2D,
  pool: FillPool,
  view: ViewTransform,
  requestRedraw?: () => void,
): void {
  if (
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
  fillClosedPolylinesBatched(ctx, WORLD, pool.contours, view, 'evenodd');
  // Every contour of an even-odd region is one of its edges, so this outline
  // only shows where copies cancel: LightBurn draws them unfilled, not gone.
  ctx.strokeStyle = pool.color;
  ctx.lineWidth = pool.widthPx;
  strokePolylinesBatched(ctx, WORLD, pool.contours, view);
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

// Every filled path with closed contours, by the operation, colour and output
// it paints with: one pool can only hold paths that paint alike.
function operationMembers(
  entries: ReadonlyArray<ResolvedVector | undefined>,
): Map<string, Member[]> {
  const byOperation = new Map<string, Member[]>();
  entries.forEach((entry, index) => {
    if (entry === undefined || isRegistrationBox(entry.object)) return;
    entry.display.paths.forEach((path, pathIndex) => {
      const { paint, operationId } = path;
      if (paint.kind !== 'fill' || operationId === null) return;
      if (!path.display.polylines.some((polyline) => polyline.closed)) return;
      const key = `${operationId}\n${paint.color}\n${paint.output ? 1 : 0}`;
      const members = byOperation.get(key) ?? [];
      let member = members.at(-1);
      if (member?.index !== index) {
        const box = vectorObjectWorldBounds(entry.object);
        if (box === null) return;
        member = { index, object: entry.object, paths: [], pathIndexes: [], box };
        members.push(member);
        byOperation.set(key, members);
      }
      member.paths.push(path);
      member.pathIndexes.push(pathIndex);
    });
  });
  return byOperation;
}

// Members linked by overlapping boxes, each cluster in drawing order. Sweep on
// x, so a large array of side-by-side parts stays near linear.
function overlappingClusters(members: ReadonlyArray<Member>): Member[][] {
  const parent = members.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) current = parent[current] as number;
    parent[index] = current;
    return current;
  };
  const order = members
    .map((_, index) => index)
    .sort((a, b) => (members[a] as Member).box.minX - (members[b] as Member).box.minX);
  for (let i = 0; i < order.length; i += 1) {
    const a = order[i] as number;
    const boxA = (members[a] as Member).box;
    for (let j = i + 1; j < order.length; j += 1) {
      const b = order[j] as number;
      const boxB = (members[b] as Member).box;
      if (boxB.minX > boxA.maxX) break;
      if (boxB.minY <= boxA.maxY && boxB.maxY >= boxA.minY) parent[root(b)] = root(a);
    }
  }
  const clusters = new Map<number, Member[]>();
  members.forEach((member, index) => {
    const cluster = clusters.get(root(index)) ?? [];
    cluster.push(member);
    clusters.set(root(index), cluster);
  });
  return [...clusters.values()];
}

// A pool's world contours are rebuilt only when one of its members changes.
const poolContourCache = new WeakMap<
  VectorSceneObject,
  {
    readonly parts: ReadonlyArray<readonly [VectorSceneObject, ReadonlyArray<Polyline>]>;
    readonly contours: ReadonlyArray<Polyline>;
  }
>();

function buildPool(cluster: ReadonlyArray<Member>): FillPool {
  const first = cluster[0] as Member;
  const parts = cluster.map((member) => [member.object, memberParityContours(member)] as const);
  const cached = poolContourCache.get(first.object);
  const reusable =
    cached !== undefined &&
    cached.parts.length === parts.length &&
    cached.parts.every(
      ([object, contours], i) => object === parts[i]?.[0] && contours === parts[i]?.[1],
    );
  const contours = reusable ? cached.contours : worldContours(parts);
  if (!reusable) poolContourCache.set(first.object, { parts, contours });
  const paint = first.paths[0]?.paint;
  const segmentCount = countPolylineSegments(contours);
  return {
    color: paint?.color ?? '',
    widthPx: artworkStrokeWidthPx(segmentCount, paint?.output !== false),
    contours,
    segmentCount,
    memberIds: cluster.map((member) => member.object.id),
  };
}

function worldContours(
  parts: ReadonlyArray<readonly [VectorSceneObject, ReadonlyArray<Polyline>]>,
): Polyline[] {
  return parts.flatMap(([object, contours]) =>
    contours.map((contour) => ({
      closed: true,
      points: contour.points.map((point) => applyTransform(point, object.transform)),
    })),
  );
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
