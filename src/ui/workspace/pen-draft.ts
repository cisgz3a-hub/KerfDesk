// pen-draft — the pen tool's unfinished path and the small edits the pointer
// and keyboard make to it (ADR-380). Kept free of the canvas and the stores so
// every placement rule is unit-testable. Ephemeral like the drag draft: never
// persisted, never undoable; finishing commits it as one undoable edit.

import type { SnapKind } from '../../core/design/snap';
import type { Vec2 } from '../../core/scene';
import type { PenNode } from '../../core/shapes/pen-path';

// A path needs 2 nodes to finish open and 3 to close (a 2-node "closed" path
// would retrace itself, which LightBurn won't close either).
export const MIN_PEN_NODES_OPEN = 2;
export const MIN_PEN_NODES_CLOSED = 3;

// S toggles between placing corner nodes and auto-smooth nodes.
export type PenNodeMode = 'corner' | 'smooth';

// An open end of an existing path, in scene millimetres.
export type PenEndpointRef = {
  readonly objectId: string;
  readonly pathIndex: number;
  readonly curveIndex: number;
  readonly end: 'start' | 'end';
  readonly point: Vec2;
};

export type PenDraft = {
  readonly nodes: ReadonlyArray<PenNode>;
  // Set when drawing began on an existing path's open end: the first node is
  // that end, and finishing extends that path instead of adding an object.
  readonly continues?: PenEndpointRef;
};

// The object-snap vocabulary shared with the Design Studio, plus the grid.
export type PenSnapKind = SnapKind | 'grid';

// What pressing at the hovered point would do. 'continue' starts from an
// existing open end; 'join' finishes on one; 'close' finishes a closed shape.
export type PenIntent = 'place' | 'close' | 'join' | 'continue';

export type PenHover = {
  readonly point: Vec2;
  readonly snap: PenSnapKind | null;
  readonly intent: PenIntent;
};

export function penNodeForMode(point: Vec2, mode: PenNodeMode): PenNode {
  return mode === 'smooth' ? { kind: 'auto', point } : { kind: 'corner', point };
}

export function appendPenNode(draft: PenDraft, node: PenNode): PenDraft {
  return { ...draft, nodes: [...draft.nodes, node] };
}

export function replacePenNode(draft: PenDraft, index: number, node: PenNode): PenDraft {
  if (index < 0 || index >= draft.nodes.length) return draft;
  return { ...draft, nodes: draft.nodes.map((current, i) => (i === index ? node : current)) };
}

/** Backspace: drop the newest node; removing the only node abandons the path. */
export function removeLastPenNode(draft: PenDraft): PenDraft | null {
  if (draft.nodes.length <= 1) return null;
  return { ...draft, nodes: draft.nodes.slice(0, -1) };
}

export function canFinishPenDraft(draft: PenDraft, closed: boolean): boolean {
  return draft.nodes.length >= (closed ? MIN_PEN_NODES_CLOSED : MIN_PEN_NODES_OPEN);
}

export function lastPenNode(draft: PenDraft | null): PenNode | undefined {
  return draft?.nodes[draft.nodes.length - 1];
}

/** Shift: hold the direction from `origin` to the nearest 45 degrees. */
export function constrainPenDirection(origin: Vec2, point: Vec2): Vec2 {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return point;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
}

export function samePenHover(a: PenHover | null, b: PenHover | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.intent === b.intent && a.snap === b.snap && a.point.x === b.point.x && a.point.y === b.point.y
  );
}
