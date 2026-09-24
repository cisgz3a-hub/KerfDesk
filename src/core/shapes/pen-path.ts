// pen-path — exact geometry for the Draw Lines (pen) tool (ADR-380). Every
// node stays where it was placed. Two corner sides meet in a straight segment;
// a smooth side contributes a cubic handle, either the one dragged out while
// placing the node or, for an auto-smooth node (S mode), one derived from its
// neighbours. Nothing is refitted afterwards, so a clicked corner stays a
// corner (https://docs.lightburnsoftware.com/2.1/Reference/DrawLines/).

import {
  curveSubpathBounds,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type ShapeObject,
  type Vec2,
} from '../scene';
import { CURRENT_POLYLINE_FAIRING_VERSION } from './create-polyline';

export type PenNode =
  | { readonly kind: 'corner'; readonly point: Vec2 }
  // Smooth node whose tangent follows its neighbours (LightBurn's S mode).
  | { readonly kind: 'auto'; readonly point: Vec2 }
  // Smooth node with a dragged handle; the incoming handle mirrors it.
  | { readonly kind: 'smooth'; readonly point: Vec2; readonly handleOut: Vec2 };

export type PenNodeHandles = {
  readonly handleIn: Vec2 | null;
  readonly handleOut: Vec2 | null;
};

// An auto-smooth handle reaches a third of the way to its neighbour, the usual
// cubic spacing, so a short side never overshoots into its neighbour.
const AUTO_HANDLE_FRACTION = 1 / 3;
const EPSILON_MM = 1e-9;

export function mirrorPenHandle(point: Vec2, handle: Vec2): Vec2 {
  return { x: 2 * point.x - handle.x, y: 2 * point.y - handle.y };
}

/** Resolve every node's incoming and outgoing handle; null means a corner side. */
export function penNodeHandles(
  nodes: ReadonlyArray<PenNode>,
  closed: boolean,
): ReadonlyArray<PenNodeHandles> {
  return nodes.map((node, index) => {
    if (node.kind === 'corner') return NO_HANDLES;
    if (node.kind === 'smooth') {
      if (distance(node.point, node.handleOut) <= EPSILON_MM) return NO_HANDLES;
      return { handleIn: mirrorPenHandle(node.point, node.handleOut), handleOut: node.handleOut };
    }
    return autoHandles(nodes, index, closed);
  });
}

const NO_HANDLES: PenNodeHandles = { handleIn: null, handleOut: null };

// Catmull-Rom style tangent: parallel to the line joining the two neighbours.
// An open path's end has one neighbour and nothing to be smooth against, so it
// stays a corner side rather than growing a handle along its own chord.
function autoHandles(
  nodes: ReadonlyArray<PenNode>,
  index: number,
  closed: boolean,
): PenNodeHandles {
  const node = nodes[index];
  const previous = neighbour(nodes, index - 1, closed);
  const next = neighbour(nodes, index + 1, closed);
  if (node === undefined || previous === null || next === null) return NO_HANDLES;
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON_MM) return NO_HANDLES;
  const inReach = distance(node.point, previous) * AUTO_HANDLE_FRACTION;
  const outReach = distance(node.point, next) * AUTO_HANDLE_FRACTION;
  return {
    handleIn: {
      x: node.point.x - (dx / length) * inReach,
      y: node.point.y - (dy / length) * inReach,
    },
    handleOut: {
      x: node.point.x + (dx / length) * outReach,
      y: node.point.y + (dy / length) * outReach,
    },
  };
}

function neighbour(nodes: ReadonlyArray<PenNode>, index: number, closed: boolean): Vec2 | null {
  if (nodes.length < 2) return null;
  if (index >= 0 && index < nodes.length) return nodes[index]?.point ?? null;
  if (!closed || nodes.length < 3) return null;
  return nodes[(index + nodes.length) % nodes.length]?.point ?? null;
}

/**
 * The exact curve through the placed nodes. A closed path ends with an
 * explicit segment back to its start, the convention every closed curve in
 * the scene follows. Returns null for an empty node list.
 */
export function penNodesToCurve(
  nodes: ReadonlyArray<PenNode>,
  closed: boolean,
): CurveSubpath | null {
  const first = nodes[0];
  if (first === undefined) return null;
  const isClosed = closed && nodes.length >= 3;
  const handles = penNodeHandles(nodes, isClosed);
  const segments: PathSegment[] = [];
  const count = isClosed ? nodes.length : nodes.length - 1;
  for (let index = 0; index < count; index += 1) {
    const nextIndex = (index + 1) % nodes.length;
    const from = nodes[index];
    const to = nodes[nextIndex];
    if (from === undefined || to === undefined) continue;
    segments.push(
      penSegment(from.point, to.point, handles[index]?.handleOut, handles[nextIndex]?.handleIn),
    );
  }
  return { start: first.point, segments, closed: isClosed };
}

function penSegment(
  from: Vec2,
  to: Vec2,
  control1: Vec2 | null | undefined,
  control2: Vec2 | null | undefined,
): PathSegment {
  if ((control1 ?? null) === null && (control2 ?? null) === null) return { kind: 'line', to };
  return { kind: 'cubic', control1: control1 ?? from, control2: control2 ?? to, to };
}

/**
 * A pen drawing as a kind:'shape' polyline object. `spec.points` records the
 * placed nodes; the canonical curve carries the exact segments. The fairing
 * stamp tells the legacy fairing migration (ADR-214) that this geometry is
 * authoritative, so no load or later edit ever refits it.
 */
export function createPenPath(args: {
  readonly id: string;
  readonly color: string;
  readonly nodes: ReadonlyArray<PenNode>;
  readonly closed: boolean;
}): ShapeObject | null {
  const curve = penNodesToCurve(args.nodes, args.closed);
  if (curve === null) return null;
  const polyline = flattenPenCurve(curve);
  if (polyline === null) return null;
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'polyline', points: args.nodes.map((node) => node.point), closed: curve.closed },
    color: args.color,
    bounds: curveSubpathBounds(curve),
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: args.color, polylines: [polyline], curves: [curve] }],
    fairingVersion: CURRENT_POLYLINE_FAIRING_VERSION,
  };
}

/** Compatibility polyline for a pen curve; line-only curves keep their exact points. */
export function flattenPenCurve(curve: CurveSubpath): Polyline | null {
  const flattened = flattenCurveSubpath(curve, { toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM });
  return flattened.kind === 'ok' ? flattened.polyline : null;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
