import type { Vec2 } from '../../scene';
import { projectOntoSegment } from './polyline-window';
import { SegmentGrid, type GridSegment } from './spatial-grid';

export type WeldChain = { points: Vec2[]; closed: boolean; alive: boolean };

/** A stage-local segment index. Only the segments adjacent to moved endpoints
 * change during welding; stale entries are ignored without rebuilding the
 * entire drawing. Each open chain moves at most two endpoints in this stage. */
export class WeldFootFinder {
  private readonly grid: SegmentGrid;
  private readonly firstOwner = new Map<WeldChain, number>();
  private readonly pointOwners = new Map<Vec2[], number[]>();

  constructor(
    private readonly polylines: ReadonlyArray<WeldChain>,
    maxReach: number,
  ) {
    this.grid = new SegmentGrid(maxReach);
    for (let ownerId = 0; ownerId < polylines.length; ownerId += 1) {
      const chain = polylines[ownerId];
      if (chain === undefined) continue;
      if (!this.firstOwner.has(chain)) this.firstOwner.set(chain, ownerId);
      const owners = this.pointOwners.get(chain.points) ?? [];
      owners.push(ownerId);
      this.pointOwners.set(chain.points, owners);
      if (!chain.alive || chain.points.length < 2) continue;
      const count = chain.points.length - (chain.closed ? 0 : 1);
      for (let segIndex = 0; segIndex < count; segIndex += 1) this.insertSegment(ownerId, segIndex);
    }
  }

  endpointChanged(chain: WeldChain, which: 'start' | 'end'): void {
    const pointIndex = which === 'start' ? 0 : chain.points.length - 1;
    // Aliased point arrays also observe the replaced vertex.
    for (const ownerId of this.pointOwners.get(chain.points) ?? []) {
      const owner = this.polylines[ownerId];
      if (owner === undefined || !owner.alive || owner.points.length < 2) continue;
      const count = owner.points.length - (owner.closed ? 0 : 1);
      for (const adjacent of [pointIndex - 1, pointIndex]) {
        const segIndex = owner.closed ? (adjacent + count) % count : adjacent;
        if (segIndex >= 0 && segIndex < count) this.insertSegment(ownerId, segIndex);
      }
    }
  }

  nearestFootOnOthers(end: Vec2, own: WeldChain, reachPx: number): Vec2 | null {
    const ownIndex = this.firstOwner.get(own);
    const seen = new Set<string>();
    const candidates: GridSegment[] = [];
    for (const segment of this.grid.query(end, reachPx)) {
      if (segment.ownerId === ownIndex || !this.isCurrent(segment)) continue;
      const key = `${segment.ownerId}:${segment.segIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(segment);
    }
    // Exact original array order: the first strict minimum still wins ties.
    candidates.sort((a, b) => a.ownerId - b.ownerId || a.segIndex - b.segIndex);
    let best: Vec2 | null = null;
    let bestDist = reachPx;
    for (const segment of candidates) {
      const foot = projectOntoSegment(end, segment.a, segment.b);
      const distance = Math.hypot(foot.x - end.x, foot.y - end.y);
      if (distance < bestDist) {
        bestDist = distance;
        best = foot;
      }
    }
    return best;
  }

  private isCurrent(segment: GridSegment): boolean {
    const points = this.polylines[segment.ownerId]?.points;
    return (
      points !== undefined &&
      points[segment.segIndex] === segment.a &&
      points[(segment.segIndex + 1) % points.length] === segment.b
    );
  }

  private insertSegment(ownerId: number, segIndex: number): void {
    const points = this.polylines[ownerId]?.points;
    if (points === undefined) return;
    const a = points[segIndex];
    const b = points[(segIndex + 1) % points.length];
    if (a !== undefined && b !== undefined) this.grid.insert({ ownerId, segIndex, a, b });
  }
}
