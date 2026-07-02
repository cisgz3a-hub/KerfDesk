import { profileSupportsCapability } from '../../core/devices';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { usePlatform } from '../app/platform-context';
import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from '../app/file-actions';
import { handleSaveProcessedBitmap } from '../app/save-processed-bitmap';
import { currentOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { isConvertibleVector } from '../raster/vector-to-bitmap';
import {
  selectedCloseableOpenFillContourCount,
  selectedOpenFillContourCount,
} from '../common/fill-diagnostics';
import type {
  CommandDialogs,
  CommandSelection,
  CommandShellCallbacks,
} from './app-command-context-types';
import { buildAppCommands, type AppCommand } from './command-registry';
import type { AppCommandContext } from './command-types';
import { selectedImageMaskPair } from './image-mask-command-state';
import {
  applyImageMaskAction,
  cropImageAction,
  removeImageMaskAction,
  retraceOriginalAction,
  traceSourceForTracedImage,
  traceImageAction,
} from './image-command-actions';
import { hasPreviewableContent } from './previewable-content';
import {
  selectedObject,
  selectedObjectIds,
  selectionCanBreakApart,
  selectionCanWeld,
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
  return buildAppCommands(
    appCommandContext(callbacks, platform, app, laser, pushToast, {
      openImageDialog,
      openTextDialog,
      measureTool: () => setToolMode({ kind: 'measure' }),
      measureActive: toolMode.kind === 'measure',
      registrationPanelOpen,
      toggleRegistrationPanel,
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
    machineKind: projectMachineKind(app.project),
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
    hasRasterSelection: selected?.kind === 'raster-image',
    canRetraceOriginal: traceSourceForTracedImage(app.project, selected) !== null,
    hasConvertibleSelection: selected !== null && isConvertibleVector(selected),
    canConvertSelectionToPath: selectionHasUnlockedVectorObject(app.project, selectedIds),
    canWeldSelection: selectionCanWeld(app.project, selectedIds),
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
  | 'importImage'
  | 'saveGcode'
> {
  return {
    confirmDiscard: (action) => confirmDiscardAsync(platform, action),
    newProject: app.newProject,
    openProject: () => openProject(platform, app.setProject, app.markLoaded, pushToast),
    saveProject: () => saveProject(platform, app, pushToast, false),
    saveProjectAs: () => saveProject(platform, app, pushToast, true),
    importSvg: () => void handleImportSvg(platform, app.importSvgObject, pushToast),
    importImage: callbacks.requestImportImage,
    saveGcode: saveGcodeAction(platform, app, laser, pushToast),
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

function toolCommandContext(
  callbacks: CommandShellCallbacks,
  app: ReturnType<typeof useStore.getState>,
  platform: ReturnType<typeof usePlatform>,
  dialogs: CommandDialogs,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
  selection: CommandSelection,
): Pick<
  AppCommandContext,
  | 'materialTest'
  | 'intervalTest'
  | 'scanOffsetTest'
  | 'focusTest'
  | 'optimizationSettings'
  | 'adjustImage'
  | 'saveProcessedBitmap'
  | 'traceImage'
  | 'retraceOriginal'
  | 'multiFileTrace'
  | 'convertSelectionToPath'
  | 'weldSelection'
  | 'convertToBitmap'
  | 'fillSelectionSeparately'
  | 'closeSelectedOpenFillContours'
  | 'reviewCloseOpenFillContours'
  | 'applyImageMask'
  | 'cropImage'
  | 'removeImageMask'
> {
  return {
    materialTest: callbacks.requestMaterialTest,
    intervalTest: callbacks.requestIntervalTest,
    scanOffsetTest: callbacks.requestScanOffsetTest,
    focusTest: callbacks.requestFocusTest,
    optimizationSettings: callbacks.requestOptimizationSettings,
    adjustImage: callbacks.requestAdjustImage,
    saveProcessedBitmap: saveProcessedBitmapAction(platform, app, pushToast),
    traceImage: traceImageAction(selection.selected, dialogs.openImageDialog),
    retraceOriginal: retraceOriginalAction(
      app.project,
      selection.selected,
      dialogs.openImageDialog,
      pushToast,
    ),
    multiFileTrace: callbacks.requestMultiFileTrace,
    convertSelectionToPath: app.convertSelectionToPath,
    weldSelection: app.weldSelection,
    convertToBitmap: callbacks.requestConvertToBitmap,
    fillSelectionSeparately: app.fillSelectionSeparately,
    closeSelectedOpenFillContours: app.closeSelectedOpenFillContours,
    reviewCloseOpenFillContours: callbacks.requestCloseOpenFillContoursWithTolerance,
    applyImageMask: applyImageMaskAction(app, selection.imageMaskPair),
    cropImage: cropImageAction(app, selection.selected, pushToast),
    removeImageMask: removeImageMaskAction(app, selection.selected),
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
    connectLaser: () => void laser.connect(platform),
    disconnectLaser: () => void laser.disconnect().catch(() => undefined),
    homeLaser: () => void laser.home().catch(() => undefined),
  };
}

function windowHelpCommandContext(
  callbacks: CommandShellCallbacks,
  app: ReturnType<typeof useStore.getState>,
): Pick<
  AppCommandContext,
  'togglePreview' | 'resetView' | 'projectNotes' | 'undoHistory' | 'showAbout'
> {
  return {
    togglePreview: app.togglePreview,
    resetView: useUiStore.getState().resetView,
    projectNotes: callbacks.requestProjectNotes,
    undoHistory: callbacks.requestUndoHistory,
    showAbout: callbacks.showAbout,
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

function saveProcessedBitmapAction(
  platform: ReturnType<typeof usePlatform>,
  app: ReturnType<typeof useStore.getState>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): () => void {
  return () =>
    void handleSaveProcessedBitmap({
      platform,
      project: app.project,
      selectedObjectId: app.selectedObjectId,
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

// Projects saved before MachineConfig existed have no machine field; they
// are laser projects (the pre-CNC default).
function projectMachineKind(
  project: ReturnType<typeof useStore.getState>['project'],
): AppCommandContext['machineKind'] {
  return project.machine?.kind ?? 'laser';
}

function deleteSelection(): void {
  const state = useStore.getState();
  const ids = [
    ...(state.selectedObjectId !== null ? [state.selectedObjectId] : []),
    ...state.additionalSelectedIds,
  ];
  state.removeSceneObjects(ids);
}
