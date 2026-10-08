import { create } from 'zustand';
import type { OutputScope, Project } from '../../core/scene';
import {
  cncPreparationInputs,
  type CncPreparationInputs,
} from '../../core/cnc/cnc-preparation-dependencies';
import { useStore } from './store';

export const useCncPreparationEvidenceStore = create<{
  readonly evidence: {
    readonly documentEpoch: number;
    readonly inputs: CncPreparationInputs;
    readonly source: 'Preview' | 'Export';
  } | null;
}>(() => ({ evidence: null }));

/** A completed current request may publish display evidence. This never grants Start. */
export function recordCncPreparation(
  project: Project,
  scope: OutputScope | undefined,
  source: 'Preview' | 'Export',
): void {
  const state = useStore.getState();
  if (project.machine?.kind !== 'cnc' || state.project !== project) return;
  useCncPreparationEvidenceStore.setState({
    evidence: {
      documentEpoch: state.projectDocumentEpoch,
      inputs: cncPreparationInputs(project, scope),
      source,
    },
  });
}
