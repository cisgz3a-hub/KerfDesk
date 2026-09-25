// Which artwork the node tool is editing, and what of it lies under the
// pointer (ADR-376). Only the single selected artwork shows its nodes, so only
// it answers hover and the editing keys; a node wins over the segments it
// joins, the way it is drawn on top of them.

import { applyTransform, type Project, type Vec2 } from '../../core/scene';
import { nodeEditableObject, type NodeEditableObject } from '../state/path-curve-object-edit';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { pathNodePoint } from '../state/path-node-edit-geometry';
import { hitPathNode } from './path-node-hit-test';
import { hitPathSegment, type PathSegmentHit } from './path-segment-hit-test';

export type NodeEditSelection = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
};

export type NodeEditHover =
  | { readonly kind: 'node'; readonly ref: PathNodeRef }
  | { readonly kind: 'segment'; readonly hit: PathSegmentHit };

export function nodeEditTarget(selection: NodeEditSelection): NodeEditableObject | null {
  if (selection.selectedObjectId === null || selection.additionalSelectedIds.size > 0) return null;
  return nodeEditableObject(selection.project, selection.selectedObjectId);
}

export function nodeEditHoverAt(
  selection: NodeEditSelection,
  point: Vec2,
  pxToMm: number,
): NodeEditHover | null {
  const object = nodeEditTarget(selection);
  if (object === null) return null;
  const scene = { ...selection.project.scene, objects: [object] };
  const node = hitPathNode(scene, point, pxToMm, selection.selectedPathNodes);
  if (node !== null) return { kind: 'node', ref: node };
  const segment = hitPathSegment(object, selection.project.scene.layers, point, pxToMm);
  return segment === null ? null : { kind: 'segment', hit: segment };
}

/** Scene position of a node or curve handle. */
export function pathNodeScenePoint(project: Project, ref: PathNodeRef): Vec2 | null {
  const object = project.scene.objects.find((candidate) => candidate.id === ref.objectId);
  if (object === undefined || !('paths' in object)) return null;
  const local = pathNodePoint(object.paths, ref);
  return local === null ? null : applyTransform(local, object.transform);
}
