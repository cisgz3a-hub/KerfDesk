import type { Project } from '../../core/scene';
import type { AppState } from './store';

type SetupHistoryContext = Pick<
  AppState,
  | 'jobPlacement'
  | 'outputScopeSettings'
  | 'cachedCncMachine'
  | 'selectedObjectId'
  | 'additionalSelectedIds'
  | 'probeSetupEpoch'
>;

const contexts = new WeakMap<Project, SetupHistoryContext>();

export function captureSetupHistoryContext(project: Project, state: AppState): void {
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

export function setupHistoryContextFor(project: Project): SetupHistoryContext | null {
  const context = contexts.get(project);
  return context === undefined
    ? null
    : { ...context, additionalSelectedIds: new Set(context.additionalSelectedIds) };
}
