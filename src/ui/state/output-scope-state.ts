import type { OutputScope } from '../../core/scene';
import type { OutputScopeSettings } from './store';

type OutputScopeState = {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly outputScopeSettings: OutputScopeSettings;
};

export function currentOutputScope(state: OutputScopeState): OutputScope {
  return {
    cutSelectedGraphics: state.outputScopeSettings.cutSelectedGraphics,
    useSelectionOrigin: state.outputScopeSettings.useSelectionOrigin,
    selectedObjectIds: [
      ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
      ...state.additionalSelectedIds,
    ],
  };
}
