import { create } from 'zustand';
import type { Layer, Project } from '../../core/scene';
import { BROWSER_FREE_BUILD } from '../../platform/build-capabilities';
import type { ProFeature } from '../licensing/pro-features';
import { operationProFeature } from '../licensing/pro-operation-policy';
import { visitWorkflowArchives } from '../../io/project/project-workflow-archives';

export type PendingProProject = {
  readonly id: string;
  readonly project: Project;
  readonly features: ReadonlyArray<ProFeature>;
  readonly source: 'file' | 'autosave' | 'project';
  readonly name: string | null;
};

type PendingProProjectState = {
  readonly pending: PendingProProject | null;
  readonly dismiss: (expected: PendingProProject) => void;
};

/** An unopened original, separate from the working document and its save target. */
export const usePendingProProjectStore = create<PendingProProjectState>((set) => ({
  pending: null,
  dismiss: (expected) => set((state) => (state.pending === expected ? { pending: null } : {})),
}));

export function browserProjectProFeatures(project: Project): ReadonlyArray<ProFeature> {
  if (!BROWSER_FREE_BUILD) return [];
  const features = new Set<ProFeature>();
  addSceneFeatures(project, features);
  // Whole-file admission already applies to saved Pro content. Inactive
  // workflows retain that content rather than silently hiding or deleting it.
  const error = visitWorkflowArchives(project, (raw) => addArchivedSceneFeatures(raw, features));
  if (error !== null) throw new Error(error);
  return [...features];
}

function addArchivedSceneFeatures(raw: Record<string, unknown>, features: Set<ProFeature>): void {
  const scene = raw['scene'];
  if (
    typeof scene !== 'object' ||
    scene === null ||
    !('layers' in scene) ||
    !Array.isArray(scene.layers)
  )
    return;
  for (const layer of scene.layers) {
    if (typeof layer !== 'object' || layer === null) continue;
    const feature = operationProFeature(layer as Pick<Layer, 'cnc'>);
    if (feature !== null) features.add(feature);
  }
  if (
    'objects' in scene &&
    Array.isArray(scene.objects) &&
    scene.objects.some(
      (object) => typeof object === 'object' && object !== null && object.kind === 'relief',
    )
  )
    features.add('relief');
}

function addSceneFeatures(project: Project, features: Set<ProFeature>): void {
  for (const layer of project.scene.layers) {
    const feature = operationProFeature(layer);
    if (feature !== null) features.add(feature);
  }
  if (project.scene.objects.some((object) => object.kind === 'relief')) features.add('relief');
}

/** Null means the project may load normally. No operation or artwork is removed. */
export function preserveBrowserProProject(
  project: Project,
  origin: Pick<PendingProProject, 'source' | 'name'> = { source: 'project', name: null },
): PendingProProject | null {
  const features = browserProjectProFeatures(project);
  if (features.length === 0) return null;
  const pending = { id: crypto.randomUUID(), project, features, ...origin };
  usePendingProProjectStore.setState({ pending });
  return pending;
}

export function describePendingProProject(project: Project, name: string): void {
  usePendingProProjectStore.setState((state) =>
    state.pending?.project === project
      ? { pending: { ...state.pending, source: 'file', name } }
      : {},
  );
}
