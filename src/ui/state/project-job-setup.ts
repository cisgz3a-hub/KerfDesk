import type { JobPlacementSettings } from '../../core/job';
import type { Project } from '../../core/scene';

type OutputScopeSettings = {
  readonly cutSelectedGraphics: boolean;
  readonly useSelectionOrigin: boolean;
};

type ProjectJobSetupState = {
  readonly project: Project;
  readonly jobPlacement: JobPlacementSettings;
  readonly outputScopeSettings: OutputScopeSettings;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

export function projectWithCurrentJobSetup(state: ProjectJobSetupState): Project {
  const selectedObjectIds = [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
  return {
    ...state.project,
    jobSetup: {
      placement: state.jobPlacement,
      outputScope: {
        ...state.outputScopeSettings,
        selectedObjectIds,
      },
    },
  };
}

export function scopedSelectionProjectPatch(
  state: ProjectJobSetupState,
  selection: Pick<ProjectJobSetupState, 'selectedObjectId' | 'additionalSelectedIds'>,
) {
  if (!state.outputScopeSettings.cutSelectedGraphics) return selection;
  return {
    ...selection,
    project: projectWithCurrentJobSetup({ ...state, ...selection }),
    dirty: true,
  };
}

export function jobPlacementProjectPatch(
  state: ProjectJobSetupState,
  patch: Partial<JobPlacementSettings>,
) {
  const jobPlacement = { ...state.jobPlacement, ...patch };
  return {
    jobPlacement,
    project: projectWithCurrentJobSetup({ ...state, jobPlacement }),
    dirty: true,
  };
}

export function outputScopeProjectPatch(
  state: ProjectJobSetupState,
  patch: Partial<OutputScopeSettings>,
) {
  const merged = { ...state.outputScopeSettings, ...patch };
  const outputScopeSettings = {
    ...merged,
    useSelectionOrigin: merged.cutSelectedGraphics ? merged.useSelectionOrigin : false,
  };
  return {
    outputScopeSettings,
    project: projectWithCurrentJobSetup({ ...state, outputScopeSettings }),
    dirty: true,
  };
}
