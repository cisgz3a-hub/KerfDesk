// Transient node-editor state (ADR-376) that never enters project history:
// where the pointer last was over the canvas (the LightBurn keys act on what
// is under it), which segment was clicked for the node toolbar, and what a
// node drag is about to do (join an open end, snap, or follow a Shift guide).
//
// A selected segment remembers the stored subpath it was picked on. Any edit
// replaces that subpath, so a stale selection (after undo, or an edit that
// renumbered segments) simply stops resolving instead of pointing elsewhere.

import { create } from 'zustand';
import type { Project, Vec2 } from '../../core/scene';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import type { PathSegmentRef } from '../state/path-segment-ref';

export type NodeEditPointer = { readonly scenePoint: Vec2; readonly pxToMm: number };

export type NodeJoinCue = {
  readonly dragged: PathNodeRef;
  readonly target: PathNodeRef;
  /** Scene position of the target end, where the dragged end lands. */
  readonly point: Vec2;
};

export type NodeDragFeedback = {
  readonly join: NodeJoinCue | null;
  /** The node or segment midpoint the dragged item snapped to. */
  readonly snapPoint: Vec2 | null;
  /** Shift-constrained drags: the guide from where the item started. */
  readonly constraint: { readonly from: Vec2; readonly to: Vec2 } | null;
};

export type SelectedPathSegment = {
  readonly ref: PathSegmentRef;
  /** Where along the segment it was clicked: the piece Trim cuts away. */
  readonly t: number;
  readonly source: object;
};

type NodeEditState = {
  readonly pointer: NodeEditPointer | null;
  readonly selectedSegment: SelectedPathSegment | null;
  readonly feedback: NodeDragFeedback | null;
  readonly setPointer: (pointer: NodeEditPointer | null) => void;
  readonly selectSegment: (ref: PathSegmentRef | null, project: Project, t?: number) => void;
  readonly setFeedback: (feedback: NodeDragFeedback | null) => void;
};

export const useNodeEditStore = create<NodeEditState>((set) => ({
  pointer: null,
  selectedSegment: null,
  feedback: null,
  setPointer: (pointer) => set({ pointer }),
  selectSegment: (ref, project, t = 0.5) => {
    const source = ref === null ? null : subpathSource(project, ref);
    set({ selectedSegment: ref === null || source === null ? null : { ref, t, source } });
  },
  setFeedback: (feedback) => set({ feedback }),
}));

/** The clicked segment, while it still addresses the subpath it was picked on. */
export function resolveSelectedSegment(
  project: Project,
  selected: SelectedPathSegment | null,
): PathSegmentRef | null {
  if (selected === null) return null;
  return subpathSource(project, selected.ref) === selected.source ? selected.ref : null;
}

function subpathSource(project: Project, ref: PathSegmentRef): object | null {
  const object = project.scene.objects.find((candidate) => candidate.id === ref.objectId);
  if (object === undefined || !('paths' in object)) return null;
  const path = object.paths[ref.pathIndex];
  return path?.curves?.[ref.polylineIndex] ?? path?.polylines[ref.polylineIndex] ?? null;
}
