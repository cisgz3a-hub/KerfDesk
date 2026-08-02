import Delaunator from 'delaunator';
import type { Vec2 } from '../scene';
import { vcarveMedialSampleBudget } from './vcarve-medial-budget';
import { connectSharpCorners } from './vcarve-medial-corners';
import {
  betterVCarveMedialGraph,
  finalizeVCarveMedialGraph,
  vcarveMedialGraphNeedsRefinement,
  type MutableVCarveMedialGraph,
  type VCarveMedialGraph,
  type VCarveMedialNode,
} from './vcarve-medial-graph';
import {
  resolveVCarveMedialResolution,
  sampleVCarveBoundary,
  vcarveMedialPointKey,
  type VCarveBoundarySample,
} from './vcarve-medial-sampling';
import {
  minimumVCarveBoundaryDistance,
  pointInVCarveRegion,
  vcarveBoundarySegments,
  vcarveChordInsideRegion,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

export type { VCarveMedialGraph, VCarveMedialNode } from './vcarve-medial-graph';

export type VCarveMedialAxisPlan = {
  readonly graph: VCarveMedialGraph;
  readonly resolutionMm: number;
  readonly budgetLimited: boolean;
  readonly failed: boolean;
};

export function computeVCarveMedialAxis(
  region: VCarveMedialRegion,
  requestedResolutionMm: number,
): VCarveMedialAxisPlan {
  const segments = vcarveBoundarySegments(region);
  const sampleBudget = vcarveMedialSampleBudget(segments.length);
  const resolution = resolveVCarveMedialResolution(
    region,
    segments,
    requestedResolutionMm,
    sampleBudget,
  );
  if (resolution === null) return failedPlan();
  let attemptedResolutionMm = resolution.value;
  let best: { readonly graph: VCarveMedialGraph; readonly resolutionMm: number } | null = null;
  let geometryFailed = false;
  for (;;) {
    const sampling = sampleVCarveBoundary(segments, attemptedResolutionMm, sampleBudget);
    if (sampling.samples.length < 3) return failedPlan(attemptedResolutionMm, true);
    try {
      const mutableGraph = delaunayMedialGraph(
        region,
        segments,
        sampling.samples,
        attemptedResolutionMm,
      );
      const graph = finalizeVCarveMedialGraph(mutableGraph);
      best = betterVCarveMedialGraph(best, graph, attemptedResolutionMm);
      if (!vcarveMedialGraphNeedsRefinement(graph, attemptedResolutionMm)) {
        return {
          graph,
          resolutionMm: attemptedResolutionMm,
          budgetLimited:
            resolution.budgetLimited || sampling.budgetLimited || mutableGraph.cornerLimited,
          failed: false,
        };
      }
    } catch {
      geometryFailed = true;
    }
    const next = nextResolution(attemptedResolutionMm, resolution.minimum);
    if (next === null) break;
    attemptedResolutionMm = next;
  }
  return best === null
    ? failedPlan(attemptedResolutionMm, true)
    : {
        graph: best.graph,
        resolutionMm: best.resolutionMm,
        budgetLimited: true,
        failed: geometryFailed && best.graph.nodes.length === 0,
      };
}

function nextResolution(current: number, minimum: number): number | null {
  if (current <= minimum * (1 + Number.EPSILON * 8)) return null;
  const next = Math.max(minimum, current / 2);
  return next < current ? next : null;
}

function delaunayMedialGraph(
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  samples: ReadonlyArray<VCarveBoundarySample>,
  resolutionMm: number,
): MutableVCarveMedialGraph {
  const triangulation = new Delaunator(boundaryCoordinates(samples));
  const triangleCount = triangulation.triangles.length / 3;
  const graph: MutableVCarveMedialGraph = { nodes: [], adjacency: [], cornerLimited: false };
  const nodeForTriangle = new Int32Array(triangleCount).fill(-1);
  appendTriangleNodes(graph, nodeForTriangle, triangulation.triangles, samples, region, segments);
  connectDualEdges(graph, nodeForTriangle, triangulation.halfedges, region, segments);
  connectSharpCorners(graph, region, segments, resolutionMm);
  return graph;
}

function boundaryCoordinates(samples: ReadonlyArray<VCarveBoundarySample>): Float64Array {
  const coords = new Float64Array(samples.length * 2);
  samples.forEach((sample, index) => {
    coords[index * 2] = sample.x;
    coords[index * 2 + 1] = sample.y;
  });
  return coords;
}

function appendTriangleNodes(
  graph: MutableVCarveMedialGraph,
  nodeForTriangle: Int32Array,
  triangles: Uint32Array,
  samples: ReadonlyArray<VCarveBoundarySample>,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): void {
  const byPosition = new Map<string, number>();
  for (let triangle = 0; triangle < nodeForTriangle.length; triangle += 1) {
    const node = medialNodeForTriangle(triangle, triangles, samples, region, segments);
    if (node === null) continue;
    nodeForTriangle[triangle] = appendUniqueNode(graph, byPosition, node);
  }
}

function medialNodeForTriangle(
  triangle: number,
  triangles: Uint32Array,
  samples: ReadonlyArray<VCarveBoundarySample>,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): VCarveMedialNode | null {
  const a = sampleAt(samples, triangles[triangle * 3]);
  const b = sampleAt(samples, triangles[triangle * 3 + 1]);
  const c = sampleAt(samples, triangles[triangle * 3 + 2]);
  if (a === null || b === null || c === null) return null;
  const center = circumcenter(a, b, c);
  if (center === null || !pointInVCarveRegion(center, region)) return null;
  const clearanceMm = minimumVCarveBoundaryDistance(center, segments);
  return clearanceMm > 1e-7 && Number.isFinite(clearanceMm) ? { ...center, clearanceMm } : null;
}

function appendUniqueNode(
  graph: MutableVCarveMedialGraph,
  byPosition: Map<string, number>,
  node: VCarveMedialNode,
): number {
  const key = vcarveMedialPointKey(node);
  const existing = byPosition.get(key);
  if (existing !== undefined) return existing;
  const index = graph.nodes.length;
  byPosition.set(key, index);
  graph.nodes.push(node);
  graph.adjacency.push(new Set());
  return index;
}

function connectDualEdges(
  graph: MutableVCarveMedialGraph,
  nodeForTriangle: Int32Array,
  halfedges: Int32Array,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): void {
  for (let edge = 0; edge < halfedges.length; edge += 1) {
    const pair = dualEdgeNodePair(graph, nodeForTriangle, halfedges, edge, region, segments);
    if (pair === null) continue;
    const [firstNode, secondNode] = pair;
    graph.adjacency[firstNode]?.add(secondNode);
    graph.adjacency[secondNode]?.add(firstNode);
  }
}

function dualEdgeNodePair(
  graph: MutableVCarveMedialGraph,
  nodeForTriangle: Int32Array,
  halfedges: Int32Array,
  edge: number,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): readonly [number, number] | null {
  const opposite = halfedges[edge];
  if (opposite === undefined || opposite <= edge) return null;
  const firstNode = nodeForTriangle[Math.floor(edge / 3)] ?? -1;
  const secondNode = nodeForTriangle[Math.floor(opposite / 3)] ?? -1;
  if (firstNode < 0 || secondNode < 0 || firstNode === secondNode) return null;
  const a = graph.nodes[firstNode];
  const b = graph.nodes[secondNode];
  return a !== undefined && b !== undefined && vcarveChordInsideRegion(a, b, region, segments)
    ? [firstNode, secondNode]
    : null;
}

function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const bLength = bx * bx + by * by;
  const cLength = cx * cx + cy * cy;
  const determinant = bx * cy - by * cx;
  if (Math.abs(determinant) <= 1e-12 * Math.max(bLength, cLength, 1)) return null;
  const scale = 0.5 / determinant;
  const point = {
    x: a.x + (cy * bLength - by * cLength) * scale,
    y: a.y + (bx * cLength - cx * bLength) * scale,
  };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function sampleAt(
  samples: ReadonlyArray<VCarveBoundarySample>,
  index: number | undefined,
): VCarveBoundarySample | null {
  return index === undefined ? null : (samples[index] ?? null);
}

function failedPlan(resolutionMm = 0, budgetLimited = false): VCarveMedialAxisPlan {
  return {
    graph: { nodes: [], adjacency: [] },
    resolutionMm,
    budgetLimited,
    failed: true,
  };
}
