// External G-code preview slot (Phase H.6b, F-CNC10): a parsed .nc program
// shown in the simulator INSTEAD of the project's compiled toolpath. Session
// state only — never persisted to .lf2, cleared when Preview exits.

import type { Toolpath } from '../../core/job';
import type { AppState } from './store';

export type ExternalGcodePreview = {
  readonly name: string;
  readonly toolpath: Toolpath;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function externalGcodeActions(
  set: Setter,
): Pick<AppState, 'openExternalGcodePreview' | 'closeExternalGcodePreview'> {
  return {
    openExternalGcodePreview: (name, toolpath) =>
      set(() => ({
        externalGcodePreview: { name, toolpath },
        previewMode: true,
        selectedPathNode: null,
        selectedPathNodes: [],
      })),
    closeExternalGcodePreview: () => set(() => ({ externalGcodePreview: null })),
  };
}
