import type { Project } from '../../core/scene';

export type ProjectSaveCheckpointRequest = {
  readonly project: Project;
  readonly expectedProject: Project;
  readonly projectDocumentEpoch: number;
  /** Check before every external checkpoint commit, including after awaiting native export. */
  readonly isCurrent: () => boolean;
};
export type ProjectSaveCheckpointResult = {
  readonly project: Project;
  readonly expectedProject: Project;
};
export type ProjectSaveCheckpoint = (
  request: ProjectSaveCheckpointRequest,
) => Promise<ProjectSaveCheckpointResult | undefined>;

let checkpoint: ProjectSaveCheckpoint | null = null;

/** App-lifetime editor host registers once; closing a panel must not disable project saves. */
export function registerProjectSaveCheckpoint(callback: ProjectSaveCheckpoint): () => void {
  if (checkpoint !== null) throw new Error('A project save checkpoint is already registered');
  checkpoint = callback;
  return () => {
    if (checkpoint === callback) checkpoint = null;
  };
}

export function getProjectSaveCheckpoint(): ProjectSaveCheckpoint | null {
  return checkpoint;
}
