// Fill pools in the phone's vector projection (ADR-683 Amendment 4).
//
// The phone draws every path it is sent as one SVG path, even-odd within that
// path only, and picks the topmost object whose filled path or outline is under
// the finger. A Fill operation burns as one even-odd region across its objects
// (fill-pools.ts), so the projection sends each pool already resolved: every
// member gets its share, the part of the pool's region where it is the topmost
// member covering the point. Shares never overlap, so the phone's translucent
// fill paints the burn exactly once, and the phone's own hit test picks the
// object the desktop's does (core/scene/hit-test.ts). A member left with no
// share (a hole, a cancelled copy) sends its outline instead, unfilled, as the
// canvas draws it. The phone's renderer and the projection's contract are unchanged.

import {
  differenceClosedPolylinesChecked,
  unionClosedPolylinesChecked,
} from '../../core/geometry/polygon-difference';
import type { Polyline } from '../../core/scene';
import type { FillPoolRuns } from '../../core/scene/fill-operations';
import { planPools, type FillPool, type ResolvedVector } from '../workspace/fill-pools';

/** One member's share of one pool, in world millimetres (even-odd). */
export type PoolShare = {
  readonly color: string;
  readonly output: boolean;
  readonly contours: ReadonlyArray<Polyline>;
};

export type ProjectedPools = {
  /** Paths of the object at this index whose closed fills its pools carry. */
  readonly pooledPathsAt: (index: number) => ReadonlySet<number> | undefined;
  /** The object's shares of its pools; empty shares are left out. */
  readonly sharesAt: (index: number) => ReadonlyArray<PoolShare>;
  /** Whether some pool gave the object nothing to fill, so its pooled paths draw as outlines. */
  readonly outlinedAt: (index: number) => boolean;
};

const NO_SHARES: ReadonlyArray<PoolShare> = [];
const NOTHING_ELSE_DRAWN = (): null => null;

/** Each object's share of the Fill pools it belongs to (no artwork splits a pool here). */
export function projectFillPools(
  entries: ReadonlyArray<ResolvedVector>,
  runOf: FillPoolRuns,
): ProjectedPools {
  const planned = planPools(entries, NOTHING_ELSE_DRAWN, runOf);
  const indexById = new Map(entries.map((entry, index) => [entry.object.id, index]));
  const shares = new Map<number, PoolShare[]>();
  const outlined = new Set<number>();
  entries.forEach((_, index) => {
    for (const pool of planned.poolsAt(index)) {
      const regions = memberShares(pool);
      pool.memberIds.forEach((id, position) => {
        const member = indexById.get(id);
        if (member === undefined) return;
        const contours = regions[position] ?? [];
        if (contours.length === 0) {
          outlined.add(member);
          return;
        }
        const share = { color: pool.color, output: pool.output, contours };
        shares.set(member, [...(shares.get(member) ?? []), share]);
      });
    }
  });
  return {
    pooledPathsAt: planned.pooledPathsAt,
    sharesAt: (index) => shares.get(index) ?? NO_SHARES,
    outlinedAt: (index) => outlined.has(index),
  };
}

/**
 * Each member's share, in cluster (drawing) order: its own region, less every
 * member above it, less the points that the members below it cover an odd
 * number of times (there the pool's parity, counting this member, is even). If
 * the geometry engine fails, the lowest member carries the whole pool instead.
 */
export function memberShares(pool: FillPool): ReadonlyArray<ReadonlyArray<Polyline>> {
  const regions = pool.geometry.regions.map((region) => region.contours);
  const shares: Array<ReadonlyArray<Polyline>> = [];
  let above: ReadonlyArray<Polyline> = [];
  for (let position = regions.length - 1; position >= 0; position -= 1) {
    const own = regions[position] as ReadonlyArray<Polyline>;
    const below = regions.slice(0, position).flat();
    const share = without(without(own, above), below);
    const next = position > 0 ? unionClosedPolylinesChecked(above, own) : undefined;
    if (share === null || next?.kind === 'error') return [pool.contours];
    shares[position] = share;
    if (next !== undefined) above = next.value;
  }
  return shares;
}

function without(
  subject: ReadonlyArray<Polyline> | null,
  clip: ReadonlyArray<Polyline>,
): ReadonlyArray<Polyline> | null {
  if (subject === null || subject.length === 0 || clip.length === 0) return subject;
  const result = differenceClosedPolylinesChecked(subject, clip);
  return result.kind === 'ok' ? result.value : null;
}
