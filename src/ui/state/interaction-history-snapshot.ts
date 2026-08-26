import type { Project } from '../../core/scene';
import type { PathNodeRef } from './path-node-edit-actions';

export type InteractionHistorySnapshot = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: boolean;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly selectedPathNode: PathNodeRef | null;
  readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
};
