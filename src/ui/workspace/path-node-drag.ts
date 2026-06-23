import type { Project, Vec2 } from '../../core/scene';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { hitPathNode } from './path-node-hit-test';

export type PathNodeDragState = {
  readonly kind: 'path-node';
  readonly startScenePoint: Vec2;
};

export function beginPathNodeDrag(args: {
  readonly project: Project;
  readonly scenePoint: Vec2;
  readonly pxToMm: number;
  readonly selectPathNode: (ref: PathNodeRef | null) => void;
}): PathNodeDragState | null {
  const ref = hitPathNode(args.project.scene, args.scenePoint, args.pxToMm);
  args.selectPathNode(ref);
  return ref === null ? null : { kind: 'path-node', startScenePoint: args.scenePoint };
}

export function updatePathNodeDrag(args: {
  readonly drag: PathNodeDragState;
  readonly point: Vec2 | null;
  readonly setSelectedPathNodePositionDuringInteraction: (scenePoint: Vec2) => void;
}): void {
  if (args.point === null) return;
  args.setSelectedPathNodePositionDuringInteraction(args.point);
}
