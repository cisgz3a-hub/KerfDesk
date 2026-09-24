// pen-pointer — what the pen would do at the pointer (ADR-380): the exact
// point a press lands on and what it means there. Hover and press share it, so
// the marker the operator sees is exactly what a click commits.

import type { Project, Vec2 } from '../../core/scene';
import {
  constrainPenDirection,
  lastPenNode,
  MIN_PEN_NODES_CLOSED,
  type PenDraft,
  type PenEndpointRef,
  type PenHover,
  type PenIntent,
} from './pen-draft';
import { nearestJoinableEndpoint, penSnapReachMm, resolvePenSnap } from './pen-snap';
import type { SnapSettings } from './snapping';

// Pressing this close to the first node closes the path even with snapping
// off; a wider snap reach (Alt) widens it too.
const CLOSE_RADIUS_PX = 10;

export type PenModifiers = {
  // Shift: hold the new segment to 0/45/90 degrees.
  readonly constrain: boolean;
  // Alt: snap to points from farther away.
  readonly wide: boolean;
  // Ctrl/Cmd: place a node on an open end without continuing or joining it.
  readonly noJoin: boolean;
};

export type PenPointer = PenHover & { readonly endpoint: PenEndpointRef | null };

export function penModifiers(e: {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): PenModifiers {
  return { constrain: e.shiftKey, wide: e.altKey, noJoin: e.ctrlKey || e.metaKey };
}

export function resolvePenPointer(args: {
  readonly project: Project;
  readonly draft: PenDraft | null;
  readonly raw: Vec2;
  readonly pxToMm: number;
  readonly settings: SnapSettings;
  readonly modifiers: PenModifiers;
}): PenPointer {
  const reachMm = penSnapReachMm(args.pxToMm, args.modifiers.wide);
  const closeAt = closeTarget(
    args.draft,
    args.raw,
    Math.max(CLOSE_RADIUS_PX * args.pxToMm, reachMm),
  );
  if (closeAt !== null)
    return { point: closeAt, snap: 'endpoint', intent: 'close', endpoint: null };
  const endpoint = args.modifiers.noJoin
    ? null
    : nearestJoinableEndpoint({
        project: args.project,
        point: args.raw,
        reachMm,
        ...(args.draft?.continues === undefined ? {} : { exclude: args.draft.continues }),
      });
  if (endpoint !== null) {
    const intent = endpointIntent(args.draft, endpoint);
    return { point: endpoint.point, snap: 'endpoint', intent, endpoint };
  }
  const last = lastPenNode(args.draft);
  if (args.modifiers.constrain && last !== undefined) {
    const point = constrainPenDirection(last.point, args.raw);
    return { point, snap: null, intent: 'place', endpoint: null };
  }
  const snap = resolvePenSnap({
    project: args.project,
    point: args.raw,
    reachMm,
    settings: args.settings,
  });
  return {
    point: snap?.point ?? args.raw,
    snap: snap?.kind ?? null,
    intent: 'place',
    endpoint: null,
  };
}

// A path continued from an existing end closes by reaching that path's other
// end instead, so its own first node never closes it.
function closeTarget(draft: PenDraft | null, raw: Vec2, radiusMm: number): Vec2 | null {
  if (draft === null || draft.continues !== undefined) return null;
  if (draft.nodes.length < MIN_PEN_NODES_CLOSED) return null;
  const first = draft.nodes[0]?.point;
  if (first === undefined) return null;
  return Math.hypot(raw.x - first.x, raw.y - first.y) <= radiusMm ? first : null;
}

function endpointIntent(draft: PenDraft | null, endpoint: PenEndpointRef): PenIntent {
  if (draft === null) return 'continue';
  const continued = draft.continues;
  const sameSubpath =
    continued !== undefined &&
    continued.objectId === endpoint.objectId &&
    continued.pathIndex === endpoint.pathIndex &&
    continued.curveIndex === endpoint.curveIndex;
  return sameSubpath ? 'close' : 'join';
}
