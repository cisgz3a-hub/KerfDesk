// Sub-pixel ridge centring for the raw skeleton. Thinning keeps whole
// pixels, so a stroke whose width is an even number of pixels leaves a
// two-pixel ridge plateau and its skeleton runs along one side of it, half a
// pixel off the true centre (any thinning that keeps whole pixels does).
// The distance field still knows where the centre is: across the stroke it
// rises to the ridge and falls again, so the peak interpolated through the
// skeleton pixel and the field one pixel to either side of it lands on the
// centre — midway between the plateau's pixels for an even width, on the
// pixel itself for an odd one. The same interpolation takes the pixel
// staircase out of diagonal and curved strokes.
//
// Only positions move, and never a junction's: pairing, seam repair and the
// attachment pins find junctions by position, so every decision keyed on
// them is unchanged.

import type { Vec2 } from '../../scene';
import { interpolatedRadius } from './distance-field';
import type { StrokeChain, StrokeGraph, StrokeNode } from './stroke-graph';

// Chain points on each side used for the local stroke direction. One pixel
// step only knows eight directions; two average a staircase into a usable
// normal without reaching around a bend.
const TANGENT_REACH_POINTS = 2;
// A skeleton pixel that is the ridge maximum has its interpolated peak within
// half a pixel by construction; the clamp only guards rounding.
const MAX_SHIFT_PX = 0.5;
const NEAR_ZERO = 1e-9;

type Field = {
  readonly distSq: Float64Array;
  readonly width: number;
};

type Context = {
  readonly field: Field;
  readonly nodes: ReadonlyArray<StrokeNode>;
  /** Junction and former-junction positions, which must not move. */
  readonly fixed: ReadonlySet<string>;
  readonly movedTips: Map<number, Vec2>;
};

/**
 * Move every skeleton pixel of the graph onto the distance field's sub-pixel
 * ridge, measured across the local stroke direction. Stroke tips (endpoint
 * nodes) move with their chain; junctions stay exactly where they are.
 */
export function centerGraphOnRidge(
  graph: StrokeGraph,
  distSq: Float64Array,
  width: number,
): StrokeGraph {
  if (width <= 0) return graph;
  const fixedPositions = [
    ...graph.nodes.filter((node) => node.kind === 'junction').map((node) => node.pos),
    ...(graph.seamJunctions ?? []),
  ];
  const context: Context = {
    field: { distSq, width },
    nodes: graph.nodes,
    fixed: new Set(fixedPositions.map(positionKey)),
    movedTips: new Map(),
  };
  const chains = graph.chains.map((chain) => centerChain(chain, context));
  if (chains.every((chain, i) => chain === graph.chains[i])) return graph;
  const nodes = graph.nodes.map((node) => {
    const pos = context.movedTips.get(node.id);
    return pos === undefined ? node : { ...node, pos };
  });
  return { ...graph, nodes, chains };
}

function centerChain(chain: StrokeChain, context: Context): StrokeChain {
  const points = chain.points;
  const n = points.length;
  if (n < 2) return chain;
  const out = points.map((p, i) => {
    if (context.fixed.has(positionKey(p))) return p;
    const end = chain.closed ? null : endNode(chain, i, n);
    if (end !== null && !isOwnTip(chain, end, context.nodes)) return p;
    return ridgePoint(points, i, chain.closed, context.field) ?? p;
  });
  if (out.every((p, i) => p === points[i])) return chain;
  if (!chain.closed) {
    recordTip(chain.a, points[0], out[0], context.movedTips);
    recordTip(chain.b, points[n - 1], out[n - 1], context.movedTips);
  }
  return { ...chain, points: out };
}

function endNode(chain: StrokeChain, i: number, n: number): number | null {
  if (i === 0) return chain.a;
  return i === n - 1 ? chain.b : null;
}

// A chain end moves only when it is a stroke tip of this chain alone; a chain
// whose ends share one node (a dead-end stub) keeps that node in place.
function isOwnTip(chain: StrokeChain, nodeId: number, nodes: ReadonlyArray<StrokeNode>): boolean {
  return chain.a !== chain.b && nodes[nodeId]?.kind === 'endpoint';
}

function recordTip(
  nodeId: number,
  before: Vec2 | undefined,
  after: Vec2 | undefined,
  movedTips: Map<number, Vec2>,
): void {
  if (before !== undefined && after !== undefined && after !== before) movedTips.set(nodeId, after);
}

// The ridge position through one skeleton pixel, or null when the point is
// not a pixel centre (a junction anchor) or the field shows no ridge there.
// The field is read exactly across the stroke: sampling along a pixel axis
// instead mixes in the fall-off ALONG the stroke wherever it is not constant,
// and near a tip or a junction that dragged the point sideways by up to half
// a pixel (measured on the 45° cross fixture).
function ridgePoint(
  points: ReadonlyArray<Vec2>,
  i: number,
  closed: boolean,
  field: Field,
): Vec2 | null {
  const p = points[i];
  if (p === undefined) return null;
  if (!Number.isInteger(p.x - 0.5) || !Number.isInteger(p.y - 0.5)) return null;
  const normal = localNormal(points, i, closed);
  if (normal === null) return null;
  const shift = peakOffset(
    radiusAtPoint(field, p.x - normal.x, p.y - normal.y),
    radiusAtPoint(field, p.x, p.y),
    radiusAtPoint(field, p.x + normal.x, p.y + normal.y),
  );
  if (shift === null || shift === 0) return null;
  return { x: p.x + shift * normal.x, y: p.y + shift * normal.y };
}

/** Sub-pixel offset of the peak through three samples one pixel apart, in
 *  [-0.5, 0.5], or null when the middle sample is not a ridge maximum. The
 *  distance to the stroke edge falls off linearly on both sides of the
 *  centre, so the peak is where two lines of equal and opposite slope meet:
 *  exact for a straight edge, and exactly ±0.5 on the two-pixel plateau of
 *  an even-width stroke. (A parabola through the same samples is exact only
 *  at those two cases and measured slightly worse on the corpus.) */
export function peakOffset(before: number, at: number, after: number): number | null {
  if (at < before || at < after) return null;
  const drop = at - Math.min(before, after);
  if (drop < NEAR_ZERO) return null;
  const offset = (after - before) / (2 * drop);
  return Math.max(-MAX_SHIFT_PX, Math.min(MAX_SHIFT_PX, offset));
}

function localNormal(points: ReadonlyArray<Vec2>, i: number, closed: boolean): Vec2 | null {
  const n = points.length;
  const back = closed ? (i - TANGENT_REACH_POINTS + n) % n : Math.max(0, i - TANGENT_REACH_POINTS);
  const ahead = closed ? (i + TANGENT_REACH_POINTS) % n : Math.min(n - 1, i + TANGENT_REACH_POINTS);
  const a = points[back];
  const b = points[ahead];
  if (a === undefined || b === undefined) return null;
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const length = Math.hypot(tx, ty);
  if (length < NEAR_ZERO) return null;
  return { x: -ty / length, y: tx / length };
}

// Exact at pixel centres, so an axis-aligned normal reads the field itself.
function radiusAtPoint(field: Field, x: number, y: number): number {
  return interpolatedRadius(field.distSq, field.width, x, y);
}

function positionKey(p: Vec2): string {
  return `${p.x},${p.y}`;
}
