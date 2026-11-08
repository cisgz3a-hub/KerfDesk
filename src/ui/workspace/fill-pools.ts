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
// same pools (core/scene/hit-test.ts). Painting is fill-pool-paint.ts; the
// plan is kept between frames by fill-pool-plan-cache.ts (Amendment 3).

import { isRegistrationBox, transformedBBox, type AABB, type SceneObject } from '../../core/scene';
import { ONE_FILL_POOL_RUN, type FillPoolRuns } from '../../core/scene/fill-operations';
import { artworkStrokeWidthPx } from './draw-complexity';
import { drawnOverClusters, overlappingGroups, regroupMoved } from './fill-pool-clusters';
import { poolGeometry, type PoolGeometry } from './fill-pool-geometry';
import { parityContours } from './fill-pool-regions';
import type { ObjectDisplay, PathDisplay, VectorSceneObject } from './object-display';
import { vectorObjectWorldBounds } from './object-viewport';
import { RecentPlanValues } from './fill-pool-recent-keys';
import type { Polyline } from '../../core/scene';

export type ResolvedVector = {
  readonly object: VectorSceneObject;
  readonly display: ObjectDisplay;
};

export type FillPool = {
  /** Pools with one key are separate clusters of one operation: they never overlap. */
  readonly key: string;
  readonly color: string;
  readonly widthPx: number;
  /** World-millimetre closed contours; their even-odd parity is what burns. */
  readonly contours: ReadonlyArray<Polyline>;
  readonly segmentCount: number;
  readonly memberIds: ReadonlyArray<string>;
  /** The cluster's world box. */
  readonly box: AABB;
  /** The whole cluster's members and their world regions, in cluster order. */
  readonly geometry: PoolGeometry;
  /** One part of a split pool: these members' world regions, clipped to `contours`. */
  readonly regions?: ReadonlyArray<ReadonlyArray<Polyline>>;
};

export type FillPoolPlan = {
  /** Pools, or parts of them, painted just before the object at this index. */
  readonly poolsAt: (index: number) => ReadonlyArray<FillPool>;
  /** The object's display, less the closed fills a pool paints for it. */
  readonly displayAt: (index: number) => ObjectDisplay | undefined;
};

/** A plan before it is bound to one frame's displays (fill-pool-plan-cache.ts). */
export type PlannedPools = {
  readonly poolsAt: (index: number) => ReadonlyArray<FillPool>;
  /** Paths of the object at this index whose closed fills a pool paints. */
  readonly pooledPathsAt: (index: number) => ReadonlySet<number> | undefined;
};

/** Work counters for the count guards (Amendment 3): plans made, full overlap sweeps run. */
export const fillPoolWork = { plans: 0, sweeps: 0 };

/** How many pool keys keep their last overlap groups (the S9-P3-3 bound). */
export function keptFillPoolGroupCount(): number {
  return lastGroups.size;
}

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
const NOTHING_ELSE_DRAWN = (): AABB | null => null;

type PoolCluster = {
  readonly key: string;
  readonly pool: PoolMembers;
  readonly cluster: ReadonlyArray<Member>;
};
// A pool split into many parts is clipped once per part. A pool that would take
// a plan past this many clipped segments is painted whole at its highest member
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
  return bindPlannedPools(planPools(entries, drawnBox, runOf), entries);
}

/** A plan's answers for this frame's displays, which have the paths it was planned with. */
export function bindPlannedPools(
  planned: PlannedPools,
  entries: ReadonlyArray<ResolvedVector | undefined>,
): FillPoolPlan {
  return {
    poolsAt: planned.poolsAt,
    displayAt: (index) => {
      const display = entries[index]?.display;
      const pooled = planned.pooledPathsAt(index);
      return display === undefined || pooled === undefined
        ? display
        : withoutPooledFills(display, pooled);
    },
  };
}

export function planPools(
  entries: ReadonlyArray<ResolvedVector | undefined>,
  drawnBox: (index: number) => AABB | null,
  runOf: FillPoolRuns,
): PlannedPools {
  fillPoolWork.plans += 1;
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
  lastGroups.endPlan();
  const covering = drawnOverClusters(
    clusters.map(({ cluster }) => ({
      indexes: cluster.map((member) => member.index),
      box: unionBox(cluster),
      boxes: cluster.map((member) => member.box),
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
    pooledPathsAt: (index) => pooledPaths.get(index),
  };
}

/** The box a photo or relief covers when it is drawn, for `planFillPools`. */
export function drawnBitmapBox(object: SceneObject | undefined, drawn: boolean): AABB | null {
  return drawn && (object?.kind === 'raster-image' || object?.kind === 'relief')
    ? transformedBBox(object)
    : null;
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
// While a few members keep changing (a drag), the groups of all the others are
// kept too, and only the changing ones are joined to them (Amendment 3).
type ClusterGroups = {
  readonly objects: ReadonlyArray<VectorSceneObject>;
  readonly groups: ReadonlyArray<ReadonlyArray<number>>;
  readonly rest?: RestGroups;
};
type RestGroups = {
  readonly moved: ReadonlyArray<number>;
  readonly objects: ReadonlyArray<VectorSceneObject>;
  readonly groups: ReadonlyArray<ReadonlyArray<number>>;
};
const clusterCache = new WeakMap<VectorSceneObject, Map<string, ClusterGroups>>();
// More changing members than this re-sweep the whole operation.
const MAX_MOVED_MEMBERS = 32;

function clustersOf(key: string, members: ReadonlyArray<Member>): Member[][] {
  // Keyed on the last member: a drag usually moves one member, and that is
  // rarely the first and last at once.
  const anchor = (members.at(-1) as Member).object;
  const byKey = clusterCache.get(anchor) ?? new Map<string, ClusterGroups>();
  const cached = byKey.get(key) ?? lastGroups.get(key);
  const groups = groupsFor(cached, members);
  byKey.set(key, groups);
  clusterCache.set(anchor, byKey);
  lastGroups.set(key, groups);
  return groups.groups.map((group) => group.map((position) => members[position] as Member));
}

// The last groups seen per pool key, so a drag of the anchoring member still
// finds what it is moving away from. Kept for the keys of the last two plans
// (fill-pool-recent-keys.ts): a pool that is gone no longer holds its objects.
const lastGroups = new RecentPlanValues<ClusterGroups>();

function groupsFor(
  cached: ClusterGroups | undefined,
  members: ReadonlyArray<Member>,
): ClusterGroups {
  const objects = members.map((member) => member.object);
  const boxes = members.map((member) => member.box);
  if (cached === undefined || cached.objects.length !== objects.length)
    return swept(objects, boxes);
  const changed = changedPositions(objects, cached.objects);
  if (changed.length === 0) return cached;
  const rest = cached.rest;
  if (rest !== undefined && changedPositions(objects, rest.objects, rest.moved).length === 0) {
    return { objects, groups: regroupMoved(boxes, rest.groups, rest.moved), rest };
  }
  const moved = [...new Set([...changed, ...(rest?.moved ?? [])])].sort((a, b) => a - b);
  if (moved.length > MAX_MOVED_MEMBERS || moved.length >= objects.length) {
    return swept(objects, boxes);
  }
  const movedSet = new Set(moved);
  const stay = objects.flatMap((_, position) => (movedSet.has(position) ? [] : [position]));
  fillPoolWork.sweeps += 1;
  const restGroups = overlappingGroups(stay.map((position) => boxes[position] as AABB)).map(
    (group) => group.map((slot) => stay[slot] as number),
  );
  const next: RestGroups = { moved, objects, groups: restGroups };
  return { objects, groups: regroupMoved(boxes, restGroups, moved), rest: next };
}

function swept(
  objects: ReadonlyArray<VectorSceneObject>,
  boxes: ReadonlyArray<AABB>,
): ClusterGroups {
  fillPoolWork.sweeps += 1;
  return { objects, groups: overlappingGroups(boxes) };
}

// Positions whose object differs, leaving out `skip` (ascending).
function changedPositions(
  objects: ReadonlyArray<VectorSceneObject>,
  previous: ReadonlyArray<VectorSceneObject>,
  skip: ReadonlyArray<number> = [],
): number[] {
  const changed: number[] = [];
  let next = 0;
  for (let position = 0; position < objects.length; position += 1) {
    if (skip[next] === position) {
      next += 1;
      continue;
    }
    if (objects[position] !== previous[position]) changed.push(position);
  }
  return changed;
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
  const geometry = poolGeometry(
    key,
    cluster.map((member) => member.object),
    cluster.map((member) => parityContours(member.paths)),
  );
  const whole: FillPool = {
    key,
    color: pool.color,
    widthPx: artworkStrokeWidthPx(geometry.segmentCount, pool.output),
    contours: geometry.contours,
    segmentCount: geometry.segmentCount,
    memberIds: cluster.map((member) => member.object.id),
    box: unionBox(cluster),
    geometry,
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
      regions: part.map((position) => geometry.regions[position]?.contours ?? []),
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
