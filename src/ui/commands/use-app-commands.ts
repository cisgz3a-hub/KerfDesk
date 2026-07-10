import { profileSupportsCapability } from '../../core/devices';
import { machineKindOf } from '../../core/scene';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { usePlatform } from '../app/platform-context';
import {
  handleImportDxf,
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from '../app/file-actions';
import { handleOpenGcodePreview } from '../app/gcode-open-action';
import { connectOptionsForDevice } from './connect-options';
import { currentOutputScope, useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import {
  selectedCloseableOpenFillContourCount,
  selectedOpenFillContourCount,
} from '../common/fill-diagnostics';
import type { CommandDialogs, CommandShellCallbacks } from './app-command-context-types';
import { buildAppCommands, type AppCommand } from './command-registry';
import { toolCommandContext } from './tool-command-context';
import type { AppCommandContext } from './command-types';
import { selectedImageMaskPair } from './image-mask-command-state';
import { traceSourceForTracedImage } from './image-command-actions';
import { hasPreviewableContent } from './previewable-content';
import {
  selectedObject,
  selectedObjectIds,
  selectionCanBreakApart,
  selectionCanCombine,
  selectionCanWeld,
  selectedConvertibleVectors,
  selectionHasUnlockedObject,
  selectionHasUnlockedVectorObject,
  selectionHasVectorObject,
  selectionTouchesGroup,
} from './selection-command-state';

export type { CommandShellCallbacks } from './app-command-context-types';

export function useAppCommands(callbacks: CommandShellCallbacks): ReadonlyArray<AppCommand> {
  const platform = usePlatform();
  const app = useStore();
  const laser = useLaserStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const openTextDialog = useUiStore((s) => s.openTextDialog);
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const toolMode = useUiStore((s) => s.toolMode);
  const registrationPanelOpen = useUiStore((s) => s.registrationPanelOpen);
  const toggleRegistrationPanel = useUiStore((s) => s.toggleRegistrationPanel);
  const boardCapturePanelOpen = useUiStore((s) => s.boardCapturePanelOpen);
  const toggleBoardCapturePanel = useUiStore((s) => s.toggleBoardCapturePanel);
  const cameraPanelOpen = useCameraStore((s) => s.panelOpen);
  const toggleCameraPanel = useCameraStore((s) => s.togglePanel);
  return buildAppCommands(
    appCommandContext(callbacks, platform, app, laser, pushToast, {
      openImageDialog,
      openTextDialog,
      measureTool: () => setToolMode({ kind: 'measure' }),
      measureActive: toolMode.kind === 'measure',
      registrationPanelOpen,
      toggleRegistrationPanel,
      boardCapturePanelOpen,
      toggleBoardCapturePanel,
      cameraPanelOpen,
      toggleCameraPanel,
    }),
  );
}

function appCommandContext(
  callbacks: CommandShellCallbacks,
  platform: ReturnType<typeof usePlatform>,
  app: ReturnType<typeof useStore.getState>,
  laser: ReturnType<typeof useLaserStore.getState>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
  dialogs: CommandDialogs,
): AppCommandContext {
  const selected = selectedObject(app.project, app.selectedObjectId);
  const selectedIds = selectedObjectIds(app.selectedObjectId, app.additionalSelectedIds);
  const imageMaskPair = selectedImageMaskPair(app.project, selectedIds);
  const selection = { selected, selectedIds, imageMaskPair };
  const hasMaskedRasterSelection =
    selected?.kind === 'raster-image' && selected.imageMaskId !== undefined;
  const activeStreamer =
    laser.streamer !== null &&
    ['streaming', 'paused', 'done', 'errored'].includes(laser.streamer.status);
  return {
    ...fileCommandContext(callbacks, platform, app, laser, pushToast),
    ...editCommandContext(app, dialogs),
    ...toolCommandContext(callbacks, app, platform, dialogs, pushToast, selection),
    ...arrangeCommandContext(app),
    ...laserCommandContext(platform, laser),
    ...windowHelpCommandContext(callbacks, app),
    machineKind: machineKindOf(app.project.machine),
    dirty: app.dirty,
    savedName: app.savedName,
    serialSupported: platform.serial.isSupported(),
    connected: laser.connection.kind === 'connected',
    machineBusy:
      laser.autofocusBusy ||
      laser.motionOperation !== null ||
      laser.controllerOperation !== null ||
      activeStreamer,
    homingEnabled: app.project.device.homing.enabled,
    hasSelection: selectedIds.length > 0,
    registrationPanelOpen: dialogs.registrationPanelOpen,
    toggleRegistrationPanel: dialogs.toggleRegistrationPanel,
    boardCapturePanelOpen: dialogs.boardCapturePanelOpen,
    toggleBoardCapturePanel: dialogs.toggleBoardCapturePanel,
    cameraPanelOpen: dialogs.cameraPanelOpen,
    toggleCameraPanel: dialogs.toggleCameraPanel,
    hasRasterSelection: selected?.kind === 'raster-image',
    canRetraceOriginal: traceSourceForTracedImage(app.project, selected) !== null,
    hasConvertibleSelection: selectedConvertibleVectors(app.project, selectedIds).length > 0,
    canConvertSelectionToPath: selectionHasUnlockedVectorObject(app.project, selectedIds),
    canWeldSelection: selectionCanWeld(app.project, selectedIds),
    canCombineSelection: selectionCanCombine(app.project, selectedIds),
    hasFillableSelection: selectionHasVectorObject(app.project, selectedIds),
    canApplyImageMask: imageMaskPair !== null,
    canCloseOpenFillContours:
      selectedCloseableOpenFillContourCount(
        app.project,
        app.selectedObjectId,
        app.additionalSelectedIds,
      ) > 0,
    canReviewCloseOpenFillContours:
      selectedOpenFillContourCount(app.project, app.selectedObjectId, app.additionalSelectedIds) >
      0,
    hasMaskedRasterSelection,
    canPaste: app.sceneClipboard !== null && app.sceneClipboard.objects.length > 0,
    canGroupSelection: selectedIds.length >= 2,
    canUngroupSelection: selectionTouchesGroup(app.project, selectedIds),
    canLockSelection: selectionHasUnlockedObject(app.project, selectedIds),
    hasLockedObjects: app.project.scene.objects.some((object) => object.locked === true),
    canTransformSelection: selected !== null,
    canAlignSelection: selectedIds.length >= 2,
    canDistributeSelection: selectedIds.length >= 3,
    canBreakApartSelection: selectionCanBreakApart(app.project, selectedIds),
    focusTestAvailable:
      profileSupportsCapability(app.project.device, 'z-axis') &&
      app.project.device.zTravelConfirmed === true,
    previewActive: app.previewMode,
    hasPreviewableContent: hasPreviewableContent(app.project),
  };
}

function fileCommandContext(
  callbacks: CommandShellCallbacks,
  platform: ReturnType<typeof usePlatform>,
  app: ReturnType<typeof useStore.getState>,
  laser: ReturnType<typeof useLaserStore.getState>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): Pick<
  AppCommandContext,
  | 'confirmDiscard'
  | 'newProject'
  | 'openProject'
  | 'saveProject'
  | 'saveProjectAs'
  | 'importSvg'
  | 'importDxf'
  | 'importImage'
  | 'saveGcode'
  | 'openGcodePreview'
> {
  return {
    confirmDiscard: (action) => confirmDiscardAsync(platform, action),
    newProject: app.newProject,
    openProject: () => openProject(platform, app.setProject, app.markLoaded, pushToast),
    saveProject: () => saveProject(platform, app, pushToast, false),
    saveProjectAs: () => saveProject(platform, app, pushToast, true),
    importSvg: () => void handleImportSvg(platform, app.importSvgObject, pushToast),
    importDxf: () => void handleImportDxf(platform, app.importSvgObject, pushToast),
    importImage: callbacks.requestImportImage,
    saveGcode: saveGcodeAction(platform, app, laser, pushToast),
    openGcodePreview: () =>
      void handleOpenGcodePreview(platform, app.openExternalGcodePreview, pushToast),
  };
}

function editCommandContext(
  app: ReturnType<typeof useStore.getState>,
  dialogs: CommandDialogs,
): Pick<
  AppCommandContext,
  | 'canUndo'
  | 'canRedo'
  | 'undo'
  | 'redo'
  | 'selectAll'
  | 'copySelection'
  | 'cutSelection'
  | 'pasteClipboard'
  | 'groupSelection'
  | 'ungroupSelection'
  | 'lockSelection'
  | 'unlockAllObjects'
  | 'duplicateSelection'
  | 'deleteSelection'
  | 'clearSelection'
  | 'measureTool'
  | 'measureActive'
  | 'addText'
> {
  return {
    canUndo: app.undoStack.length > 0,
    canRedo: app.redoStack.length > 0,
    undo: app.undo,
    redo: app.redo,
    selectAll: app.selectAllObjects,
    copySelection: app.copySelection,
    cutSelection: app.cutSelection,
    pasteClipboard: app.pasteClipboard,
    groupSelection: app.groupSelection,
    ungroupSelection: app.ungroupSelection,
    lockSelection: app.lockSelection,
    unlockAllObjects: app.unlockAllObjects,
    duplicateSelection: app.duplicateSelection,
    deleteSelection: () => deleteSelection(),
    clearSelection: () => app.selectObject(null),
    measureTool: dialogs.measureTool,
    measureActive: dialogs.measureActive,
    addText: () => dialogs.openTextDialog({ mode: 'add' }),
  };
}

function arrangeCommandContext(
  app: ReturnType<typeof useStore.getState>,
): Pick<
  AppCommandContext,
  | 'alignSelection'
  | 'distributeSelection'
  | 'breakApartSelection'
  | 'flipHorizontal'
  | 'flipVertical'
> {
  return {
    alignSelection: app.alignSelection,
    distributeSelection: app.distributeSelection,
    breakApartSelection: app.breakApartSelection,
    flipHorizontal: () => app.flipSelection('horizontal'),
    flipVertical: () => app.flipSelection('vertical'),
  };
}

function laserCommandContext(
  platform: ReturnType<typeof usePlatform>,
  laser: ReturnType<typeof useLaserStore.getState>,
): Pick<AppCommandContext, 'connectLaser' | 'disconnectLaser' | 'homeLaser'> {
  return {
    connectLaser: () =>
      void laser.connect(platform, connectOptionsForDevice(useStore.getState().project.device)),
    disconnectLaser: () => void laser.disconnect().catch(() => undefined),
    homeLaser: () => void laser.home().catch(() => undefined),
  };
}

function windowHelpCommandContext(
  callbacks: CommandShellCallbacks,
  app: ReturnType<typeof useStore.getState>,
): Pick<
  AppCommandContext,
  | 'togglePreview'
  | 'resetView'
  | 'projectNotes'
  | 'undoHistory'
  | 'showAbout'
  | 'showConnectionHelp'
  | 'showSafety'
> {
  return {
    togglePreview: app.togglePreview,
    resetView: useUiStore.getState().resetView,
    projectNotes: callbacks.requestProjectNotes,
    undoHistory: callbacks.requestUndoHistory,
    showAbout: callbacks.showAbout,
    showConnectionHelp: callbacks.showConnectionHelp,
    showSafety: callbacks.showSafety,
  };
}

function saveGcodeAction(
  platform: ReturnType<typeof usePlatform>,
  app: ReturnType<typeof useStore.getState>,
  laser: ReturnType<typeof useLaserStore.getState>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): () => void {
  return () =>
    void handleSaveGcode({
      platform,
      project: app.project,
      savedName: app.savedName,
      jobPlacement: app.jobPlacement,
      outputScope: currentOutputScope(app),
      machine: {
        statusReport: laser.statusReport,
        workOriginActive: laser.workOriginActive,
        wcoCache: laser.wcoCache,
      },
      controllerSettings: laser.controllerSettings,
      pushToast,
    });
}

function openProject(
  platform: ReturnType<typeof usePlatform>,
  setProject: ReturnType<typeof useStore.getState>['setProject'],
  markLoaded: ReturnType<typeof useStore.getState>['markLoaded'],
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): void {
  void confirmDiscardAsync(platform, 'open another project').then((ok) => {
    if (!ok) return;
    return handleOpenProject({ platform, setProject, markLoaded, pushToast });
  });
}

function saveProject(
  platform: ReturnType<typeof usePlatform>,
  app: ReturnType<typeof useStore.getState>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
  forceDialog: boolean,
): void {
  void handleSaveProject(
    {
      platform,
      project: app.project,
      savedName: app.savedName,
      lastSaveTarget: app.lastSaveTarget,
      markSaved: app.markSaved,
      pushToast,
    },
    forceDialog,
  );
}

function deleteSelection(): void {
  const state = useStore.getState();
  const ids = [
    ...(state.selectedObjectId !== null ? [state.selectedObjectId] : []),
    ...state.additionalSelectedIds,
  ];
  state.removeSceneObjects(ids);
}
