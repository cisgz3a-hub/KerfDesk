// Builds the Warp and Deform slice of AppCommandContext (LBG-T06). The command
// list is rebuilt whenever the tool mode changes, so reading it here keeps the
// menu's mark on the tool that is on.

import type { Project } from '../../core/scene/project';
import { useUiStore } from '../state/ui-store';
import { startWarpDeformTool } from '../workspace/warp-deform-tool';
import { selectionHasUnlockedVectorObject } from './selection-command-state';
import type { WarpDeformCommandContext } from './warp-deform-command-types';

export function warpDeformCommandContext(
  project: Project,
  selectedIds: ReadonlyArray<string>,
): WarpDeformCommandContext {
  const mode = useUiStore.getState().toolMode;
  return {
    canWarpSelection: selectionHasUnlockedVectorObject(project, selectedIds),
    warpToolActive: mode.kind === 'warp-deform' && mode.grid === 'warp',
    deformToolActive: mode.kind === 'warp-deform' && mode.grid === 'deform',
    startWarp: () => startWarpDeformTool('warp'),
    startDeform: () => startWarpDeformTool('deform'),
  };
}
