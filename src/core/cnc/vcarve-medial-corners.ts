import type { Vec2 } from '../scene';
import {
  distinctLoopPoints,
  pointInVCarveRegion,
  vcarveChordInsideRegion,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

const MAX_SHARP_CORNER_PROBES = 256;
const MAX_CORNER_NODE_CANDIDATES = 64;
const MAX_CORNER_EXACT_CHORD_CHECKS = 256;
const CORNER_TURN_THRESHOLD_RAD = (50 * Math.PI) / 180;

type CornerGraph = {
  readonly nodes: Array<Vec2 & { readonly clearanceMm: number }>;
  readonly adjacency: Array<Set<number>>;
  cornerLimited: boolean;
};

/** Connect exact sharp tips to nearby certified medial nodes. */
export function connectSharpCorners(
  graph: CornerGraph,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  resolutionMm: number,
): void {
  const pointCount = region.loops.reduce(
    (total, loop) => total + distinctLoopPoints(loop.points).length,
    0,
  );
  const stride = Math.max(1, Math.ceil(pointCount / MAX_SHARP_CORNER_PROBES));
  if (stride > 1) graph.cornerLimited = true;
  connectLoopCorners(graph, region, segments, resolutionMm, stride);
}

function connectLoopCorners(
  graph: CornerGraph,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  resolutionMm: number,
  stride: number,
): void {
  let probes = 0;
  let exactChecksRemaining = MAX_CORNER_EXACT_CHORD_CHECKS;
  for (const loop of region.loops) {
    const points = distinctLoopPoints(loop.points);
    for (let index = 0; index < points.length; index += stride) {
      if (probes >= MAX_SHARP_CORNER_PROBES || exactChecksRemaining <= 0) {
        graph.cornerLimited = true;
        return;
      }
      probes += 1;
      const corner = points[index];
      const bisector = sharpCornerBisector(points, index, region, resolutionMm);
      if (corner === undefined || bisector === null) continue;
      const match = nearestCornerNode(
        graph,
        corner,
        bisector,
        region,
        segments,
        resolutionMm,
        exactChecksRemaining,
      );
      exactChecksRemaining -= match.checked;
      graph.cornerLimited = graph.cornerLimited || match.limited;
      if (match.node >= 0) connectCornerNode(graph, corner, match.node);
    }
  }
}

function sharpCornerBisector(
  points: ReadonlyArray<Vec2>,
  index: number,
  region: VCarveMedialRegion,
  resolutionMm: number,
): Vec2 | null {
  const previous = points[(index - 1 + points.length) % points.length];
  const corner = points[index];
  const next = points[(index + 1) % points.length];
  if (previous === undefined || corner === undefined || next === undefined) return null;
  const incoming = unit(corner.x - previous.x, corner.y - previous.y);
  const outgoing = unit(next.x - corner.x, next.y - corner.y);
  if (incoming === null || outgoing === null) return null;
  const turn = Math.acos(clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1));
  if (turn < CORNER_TURN_THRESHOLD_RAD) return null;
  const raw = unit(-incoming.x + outgoing.x, -incoming.y + outgoing.y);
  if (raw === null) return null;
  const probeDistance = Math.max(resolutionMm * 0.25, 0.001);
  if (pointInVCarveRegion(offsetPoint(corner, raw, probeDistance), region)) return raw;
  const reverse = { x: -raw.x, y: -raw.y };
  return pointInVCarveRegion(offsetPoint(corner, reverse, probeDistance), region) ? reverse : null;
}

function nearestCornerNode(
  graph: CornerGraph,
  corner: Vec2,
  bisector: Vec2,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  resolutionMm: number,
  exactCheckBudget: number,
): { readonly node: number; readonly limited: boolean; readonly checked: number } {
  const candidates: Array<{ readonly node: number; readonly score: number }> = [];
  graph.nodes.forEach((node, nodeIndex) => {
    const dx = node.x - corner.x;
    const dy = node.y - corner.y;
    const distance = Math.hypot(dx, dy);
    if (dx * bisector.x + dy * bisector.y <= 0) return;
    if (distance > node.clearanceMm + resolutionMm * 2) return;
    const score = Math.abs(dx * bisector.y - dy * bisector.x) * 4 + distance;
    candidates.push({ node: nodeIndex, score });
  });
  candidates.sort((a, b) => a.score - b.score || a.node - b.node);
  const checkedCandidates = candidates.slice(
    0,
    Math.min(MAX_CORNER_NODE_CANDIDATES, exactCheckBudget),
  );
  let checked = 0;
  for (const candidate of checkedCandidates) {
    checked += 1;
    const node = graph.nodes[candidate.node];
    if (node !== undefined && vcarveChordInsideRegion(corner, node, region, segments)) {
      return { node: candidate.node, limited: false, checked };
    }
  }
  return { node: -1, limited: candidates.length > checked, checked };
}

function connectCornerNode(graph: CornerGraph, corner: Vec2, bestNode: number): void {
  const existing = graph.nodes.findIndex(
    (node) => Math.hypot(node.x - corner.x, node.y - corner.y) <= 1e-7,
  );
  const tip = existing >= 0 ? existing : graph.nodes.length;
  if (existing < 0) {
    graph.nodes.push({ ...corner, clearanceMm: 0 });
    graph.adjacency.push(new Set());
  }
  graph.adjacency[tip]?.add(bestNode);
  graph.adjacency[bestNode]?.add(tip);
}

function offsetPoint(origin: Vec2, direction: Vec2, distance: number): Vec2 {
  return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
}

function unit(x: number, y: number): Vec2 | null {
  const length = Math.hypot(x, y);
  return length > 1e-12 ? { x: x / length, y: y / length } : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
