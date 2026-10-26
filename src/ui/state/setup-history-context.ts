import type { Project } from '../../core/scene';
import type { AppState } from './store';

export type SetupHistoryContext = Pick<
  AppState,
  | 'jobPlacement'
  | 'outputScopeSettings'
  | 'cachedCncMachine'
  | 'selectedObjectId'
  | 'additionalSelectedIds'
  | 'probeSetupEpoch'
>;

const contexts = new WeakMap<Project, SetupHistoryContext>();

export function captureSetupHistoryContext(project: Project, state: SetupHistoryContext): void {
  contexts.set(project, {
    jobPlacement: structuredClone(state.jobPlacement),
    outputScopeSettings: structuredClone(state.outputScopeSettings),
    cachedCncMachine:
      state.cachedCncMachine === null ? null : structuredClone(state.cachedCncMachine),
    selectedObjectId: state.selectedObjectId,
    additionalSelectedIds: new Set(state.additionalSelectedIds),
    probeSetupEpoch: state.probeSetupEpoch,
  });
}

/** Puts back what a refused change found, so its capture never reaches Undo
 *  (job-machine-lock.ts). */
export function restoreSetupHistoryContext(
  project: Project,
  context: SetupHistoryContext | null,
): void {
  if (context === null) contexts.delete(project);
  else contexts.set(project, context);
}

export function setupHistoryContextFor(project: Project): SetupHistoryContext | null {
  const context = contexts.get(project);
  return context === undefined
    ? null
    : { ...context, additionalSelectedIds: new Set(context.additionalSelectedIds) };
}
