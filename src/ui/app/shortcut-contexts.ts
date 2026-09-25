// The store snapshots the window-level shortcut handlers act on, read at the
// moment a key is pressed. useShortcuts used to select all of this at render
// time, and because App hosted it, every change re-rendered the whole tree:
// the 250 ms status report during a job, and every cursor hover (the output
// scope was rebuilt as a fresh object on each main-store write). Reading on
// keydown is also the freshest state a shortcut could act on.

import type { PlatformAdapter } from '../../platform/types';
import { traceImageAction } from '../commands/image-command-actions';
import {
  selectedConvertibleVectors,
  selectedObject,
  selectedObjectIds,
} from '../commands/selection-command-state';
import { currentOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { nativeBedEvidenceSnapshot } from '../state/native-bed-frame';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { confirmDiscardAsync } from './confirm-discard';
import type { EditCtx, FileCtx, ToolCtx, TransformCtx, ViewCtx } from './shortcuts';
import { toggleWorkspaceSidePanels } from './workspace-panel-actions';

export function fileShortcutContext(platform: PlatformAdapter): FileCtx {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  return {
    platform,
    project: app.project,
    projectDocumentEpoch: app.projectDocumentEpoch,
    claimProjectSaveRequest: app.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: app.projectSaveWriteCoordinator,
    jobPlacement: app.jobPlacement,
    outputScope: currentOutputScope(app),
    machine: {
      ...nativeBedEvidenceSnapshot(laser),
      statusReport: laser.statusReport,
      workOriginActive: laser.workOriginActive,
      wcoCache: laser.wcoCache,
      reportInches: laser.controllerSettings?.reportInches === true,
    },
    controllerSettings: laser.controllerSettings,
    settingsCapability: laser.capabilities.settings,
    activeWcs: laser.activeWcs,
    importSvgObject: app.importSvgObject,
    importSvgFragment: app.importSvgFragment,
    importRasterImage: app.importRasterImage,
    setProject: app.setProject,
    newProject: app.newProject,
    savedName: app.savedName,
    lastSaveTarget: app.lastSaveTarget,
    markSaved: app.markSaved,
    markProjectSaveUncertain: app.markProjectSaveUncertain,
    markLoaded: app.markLoaded,
    advanceVariablesAfter: app.advanceVariablesAfter,
    pushToast: useToastStore.getState().pushToast,
    confirmDiscard: (action) => confirmDiscardAsync(platform, action),
  };
}

export function editShortcutContext(): EditCtx {
  const app = useStore.getState();
  return {
    undo: app.undo,
    redo: app.redo,
    selectedObjectId: app.selectedObjectId,
    selectedPathNode: app.selectedPathNode,
    additionalSelectedIds: app.additionalSelectedIds,
    removeSceneObjects: app.removeSceneObjects,
    deleteSelectedPathNodes: app.deleteSelectedPathNodes,
    selectObject: app.selectObject,
    selectAllObjects: app.selectAllObjects,
    copySelection: app.copySelection,
    cutSelection: app.cutSelection,
    pasteClipboard: app.pasteClipboard,
    groupSelection: app.groupSelection,
    ungroupSelection: app.ungroupSelection,
    duplicateSelection: app.duplicateSelection,
    resetToolMode: useUiStore.getState().resetToolMode,
  };
}

export function transformShortcutContext(): TransformCtx {
  const app = useStore.getState();
  return {
    project: app.project,
    selectedObjectId: app.selectedObjectId,
    selectedPathNode: app.selectedPathNode,
    applyObjectTransform: app.applyObjectTransform,
    nudgeSelection: app.nudgeSelection,
    nudgeSelectedPathNode: app.nudgeSelectedPathNode,
    flipSelection: app.flipSelection,
  };
}

export const TOOL_SHORTCUT_CONTEXT: ToolCtx = {
  setToolMode: (mode) => useUiStore.getState().setToolMode(mode),
  openConvertToBitmap,
  openTraceImage,
};

export const VIEW_SHORTCUT_CONTEXT: ViewCtx = {
  togglePreview: () => useStore.getState().togglePreview(),
  resetView: () => useUiStore.getState().resetView(),
  zoomBy: (factor) => useUiStore.getState().zoomBy(factor),
  fitToSelection: () => useStore.getState().fitToSelection(),
  toggleSidePanels: () => toggleWorkspaceSidePanels(useUiStore.getState()),
};

// Alt/Option+T (LightBurn's Trace Image binding). The same action the Tools
// command runs: it opens Trace Image only for a selected image, so with any
// other selection the chord is a no-op, mirroring the disabled menu item.
function openTraceImage(): void {
  const s = useStore.getState();
  traceImageAction(
    selectedObject(s.project, s.selectedObjectId),
    useUiStore.getState().openImageDialog,
  )();
}

// Ctrl/Cmd+Shift+B (LightBurn's Convert to Bitmap binding). Same gate as the
// Tools command: every selected object is a convertible vector — otherwise
// the chord is a no-op, mirroring the disabled menu item.
function openConvertToBitmap(): void {
  const s = useStore.getState();
  const ids = selectedObjectIds(s.selectedObjectId, s.additionalSelectedIds);
  if (selectedConvertibleVectors(s.project, ids).length === 0) return;
  useUiStore.getState().openConvertBitmapDialog();
}
