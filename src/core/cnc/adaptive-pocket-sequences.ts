import type { PathD, PathsD } from 'clipper2-ts';
import type { Polyline, Vec2 } from '../scene';
import { maximumClearancePoint, minimumEdgeDistance } from './adaptive-pocket-entry';
import {
  ADAPTIVE_FINISH_ARC_TOLERANCE_MM,
  offsetAdaptivePaths,
  pointInPath,
  toAdaptivePolyline,
  toPolyline,
  withoutDuplicateClosure,
} from './adaptive-pocket-geometry';

export type AdaptivePocketSequence = {
  readonly entryCenter: Vec2;
  readonly entryRadiusMm: number;
  readonly finishRings: ReadonlyArray<Polyline>;
  readonly rings: ReadonlyArray<Polyline>;
};

export type SequenceResult =
  | { readonly ok: true; readonly value: ReadonlyArray<AdaptivePocketSequence> }
  | { readonly ok: false; readonly reason: string };

type OffsetNode = {
  readonly children: OffsetNode[];
  readonly levelIndex: number;
  readonly path: PathD;
  parent: OffsetNode | null;
};

const MAX_LEVELS = 4096;
const COARSE_INTERIOR_PRECISION_DECIMALS = 2;
const COARSE_INTERIOR_MIN_STEP_MM = 0.05;

export function sequencesForComponent(
  component: PathsD,
  toolDiameterMm: number,
  optimalLoadMm: number,
): SequenceResult {
  const toolRadius = toolDiameterMm / 2;
  const centerRegion = offsetAdaptivePaths(
    component,
    -toolRadius,
    ADAPTIVE_FINISH_ARC_TOLERANCE_MM,
  );
  if (centerRegion === null || centerRegion.length === 0) {
    return { ok: false, reason: 'The selected bit does not fit one of the adaptive pockets.' };
  }
  const levels = offsetLevels(centerRegion, optimalLoadMm / 2);
  if (levels === null) {
    return { ok: false, reason: 'Adaptive clearing geometry could not be calculated safely.' };
  }
  const nodes = offsetTree(levels);
  if (nodes === null) {
    return { ok: false, reason: 'Adaptive clearing geometry could not be connected safely.' };
  }
  const claimed = new Set<OffsetNode>();
  const sequences: AdaptivePocketSequence[] = [];
  // Inward offsets can split a concave pocket into multiple descendants. Walk each leaf back
  // toward the wall and let the first leaf claim shared ancestors; that preserves every ring once
  // without ever linking sibling components at cutting depth.
  for (const leaf of nodes.flat().filter((node) => node.children.length === 0)) {
    const chain = unclaimedAncestorChain(leaf, claimed);
    if (chain.length === 0) continue;
    const entrySeed = maximumClearancePoint([leaf.path]);
    if (entrySeed === null) {
      return { ok: false, reason: 'Adaptive clearing could not find a safe entry cavity.' };
    }
    const entryClearanceMm = minimumEdgeDistance(entrySeed.point, centerRegion);
    const entryRadiusMm = Math.min(toolRadius * 0.75, entryClearanceMm * 0.8);
    if (entryRadiusMm < Math.min(toolRadius * 0.2, optimalLoadMm)) {
      return {
        ok: false,
        reason: 'The pocket has no entry cavity large enough for adaptive clearing.',
      };
    }
    sequences.push({
      entryCenter: entrySeed.point,
      entryRadiusMm,
      finishRings: chain
        .filter((node) => node.levelIndex === 0)
        .map((node) => toPolyline(node.path)),
      rings: alignRingStarts(
        chain.map((node) => toAdaptivePolyline(node.path, toolRadius)),
        entrySeed.point,
      ),
    });
  }
  return sequences.length === 0
    ? { ok: false, reason: 'Adaptive clearing found no reachable pocket area.' }
    : { ok: true, value: sequences };
}

function unclaimedAncestorChain(
  leaf: OffsetNode,
  claimed: Set<OffsetNode>,
): ReadonlyArray<OffsetNode> {
  const chain: OffsetNode[] = [];
  for (
    let node: OffsetNode | null = leaf;
    node !== null && !claimed.has(node);
    node = node.parent
  ) {
    claimed.add(node);
    chain.push(node);
  }
  return chain;
}

function offsetTree(
  levels: ReadonlyArray<PathsD>,
): ReadonlyArray<ReadonlyArray<OffsetNode>> | null {
  const nodes = levels.map((level, levelIndex) =>
    level.map<OffsetNode>((path) => ({ children: [], levelIndex, path, parent: null })),
  );
  for (let levelIndex = 1; levelIndex < nodes.length; levelIndex += 1) {
    const parents = nodes[levelIndex - 1] ?? [];
    for (const child of nodes[levelIndex] ?? []) {
      const probe = child.path[0];
      if (probe === undefined) return null;
      const containing = parents.filter((parent) => pointInPath(probe, parent.path));
      if (containing.length !== 1) return null;
      const parent = containing[0];
      if (parent === undefined) return null;
      child.parent = parent;
      parent.children.push(child);
    }
  }
  return nodes;
}

function offsetLevels(centerRegion: PathsD, optimalLoadMm: number): PathsD[] | null {
  const levels: PathsD[] = [];
  // Interior rings are already at least one load step inside the independently certified finish
  // boundary. A 0.01 mm grid avoids multiplying dense source vertices when the step is >= 0.05 mm;
  // smaller loads retain the canonical 0.001 mm grid. The final verifier still proves every ring.
  const precisionDecimals =
    optimalLoadMm >= COARSE_INTERIOR_MIN_STEP_MM ? COARSE_INTERIOR_PRECISION_DECIMALS : undefined;
  for (let index = 0; index < MAX_LEVELS; index += 1) {
    const level =
      index === 0
        ? centerRegion
        : offsetAdaptivePaths(centerRegion, -index * optimalLoadMm, 0, precisionDecimals);
    if (level === null) return null;
    if (level.length === 0) break;
    levels.push(level);
  }
  return levels;
}

function alignRingStarts(
  rings: ReadonlyArray<Polyline>,
  initialPoint: Vec2,
): ReadonlyArray<Polyline> {
  const out: Polyline[] = [];
  let previous = initialPoint;
  for (const ring of rings) {
    const rotated = rotateClosedRingToNearest(ring, previous);
    out.push(rotated);
    previous = rotated.points[0] ?? previous;
  }
  return out;
}

function rotateClosedRingToNearest(ring: Polyline, point: Vec2): Polyline {
  const points = withoutDuplicateClosure(ring.points);
  if (points.length < 2) return ring;
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const candidate = points[index];
    if (candidate === undefined) continue;
    const nextDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = index;
    }
  }
  const rotated = [...points.slice(nearest), ...points.slice(0, nearest)];
  const first = rotated[0];
  return { closed: true, points: first === undefined ? rotated : [...rotated, first] };
}
