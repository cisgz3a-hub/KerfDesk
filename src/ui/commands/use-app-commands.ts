import { fileCommandContext } from './file-command-context';
import { profileSupportsCapability } from '../../core/devices';
import { machineKindOf } from '../../core/scene';
import { resetWorkspaceLayout, toggleWorkspaceSidePanels } from '../app/workspace-panel-actions';
import { usePlatform } from '../app/platform-context';
import { editImageAction } from './edit-image-action';
import { connectOptionsForDevice } from './connect-options';
import { railPanelCommandContext } from './command-context-helpers';
import { useCommandStoreState } from './use-command-store-state';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import type { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { setAppThemePreference } from '../theme/app-theme';
import { useAppThemePreference } from '../theme/use-app-theme';
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
import { deleteSelection } from './selection-delete-action';
import {
  selectedObject,
  selectedObjectIds,
  selectionCanBreakApart,
  selectionCanCombine,
  selectionCanWeld,
  unionSilhouetteOperations,
  selectionCanJoinPaths,
  selectedConvertibleVectors,
  selectionHasUnlockedObject,
  selectionHasUnlockedVectorObject,
  selectionHasVectorObject,
  selectionTouchesGroup,
  selectionUnitCount,
} from './selection-command-state';
import { controllerActionFailureHandler } from '../laser/report-controller-action-failure';

export type { CommandShellCallbacks } from './app-command-context-types';

export function useAppCommands(callbacks: CommandShellCallbacks): ReadonlyArray<AppCommand> {
  const platform = usePlatform();
  const { app, laser } = useCommandStoreState();
  const pushToast = useToastStore((s) => s.pushToast);
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  const setToolMode = useUiStore((s) => s.setToolMode);
  const toolMode = useUiStore((s) => s.toolMode);
  const registrationPanelOpen = useUiStore((s) => s.registrationPanelOpen);
  const toggleRegistrationPanel = useUiStore((s) => s.toggleRegistrationPanel);
  const boardCapturePanelOpen = useUiStore((s) => s.boardCapturePanelOpen);
  const toggleBoardCapturePanel = useUiStore((s) => s.toggleBoardCapturePanel);
  const cameraPanelOpen = useCameraStore((s) => s.panelOpen);
  const toggleCameraPanel = useCameraStore((s) => s.togglePanel);
  const layersPanelOpen = useUiStore((s) => s.railPanelVisibility.layers);
  const machinePanelOpen = useUiStore((s) => s.railPanelVisibility.machine);
  const toggleRailPanel = useUiStore((s) => s.toggleRailPanel);
  const printAndCutFeatureEnabled = useExperimentalLaserFeatures((s) => s.features.printAndCut);
  const appTheme = useAppThemePreference();
  return buildAppCommands(
    appCommandContext(callbacks, platform, app, laser, pushToast, {
      openImageDialog,
      textTool: () => setToolMode({ kind: 'text' }),
      measureTool: () => setToolMode({ kind: 'measure' }),
      measureActive: toolMode.kind === 'measure',
      registrationPanelOpen,
      toggleRegistrationPanel,
      boardCapturePanelOpen,
      toggleBoardCapturePanel,
      cameraPanelOpen,
      toggleCameraPanel,
      layersPanelOpen,
      toggleLayersPanel: () => toggleRailPanel('layers'),
      machinePanelOpen,
      toggleMachinePanel: () => toggleRailPanel('machine'),
      printAndCutFeatureEnabled,
      printAndCutProfileSupported: app.project.device.homing.enabled,
      printAndCut: callbacks.requestPrintAndCut,
      toggleSidePanels: () => toggleWorkspaceSidePanels(useUiStore.getState()),
      resetWorkspaceLayout: () => resetWorkspaceLayout(useUiStore.getState()),
      appTheme,
      setAppTheme: setAppThemePreference,
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
  const arrangeUnits = selectionUnitCount(app.project, selectedIds);
  const imageMaskPair = selectedImageMaskPair(app.project, selectedIds);
  const selection = { selected, selectedIds, imageMaskPair };
  const hasMaskedRasterSelection =
    selected?.kind === 'raster-image' && selected.imageMaskId !== undefined;
  const activeStreamer = isActiveStreamerStatus(laser.streamer?.status);
  return {
    ...fileCommandContext(callbacks, platform, app, pushToast),
    ...editCommandContext(app, dialogs),
    ...toolCommandContext(callbacks, app, platform, dialogs, pushToast, selection),
    ...arrangeCommandContext(app, callbacks),
    ...laserCommandContext(platform, laser),
    ...windowHelpCommandContext(callbacks, app),
    ...connectionCommandContext(app, laser, platform, activeStreamer),
    hasSelection: selectedIds.length > 0,
    registrationPanelOpen: dialogs.registrationPanelOpen,
    toggleRegistrationPanel: dialogs.toggleRegistrationPanel,
    boardCapturePanelOpen: dialogs.boardCapturePanelOpen,
    toggleBoardCapturePanel: dialogs.toggleBoardCapturePanel,
    cameraPanelOpen: dialogs.cameraPanelOpen,
    toggleCameraPanel: dialogs.toggleCameraPanel,
    ...railPanelCommandContext(dialogs, activeStreamer),
    hasRasterSelection: selected?.kind === 'raster-image',
    editImage: editImageAction(
      platform,
      selected,
      () => useStore.getState().projectDocumentEpoch,
      app.importSvgObject,
      app.importRasterImage,
      pushToast,
    ),
    canRetraceOriginal: traceSourceForTracedImage(app.project, selected) !== null,
    hasConvertibleSelection: selectedConvertibleVectors(app.project, selectedIds).length > 0,
    canConvertSelectionToPath: selectionHasUnlockedVectorObject(app.project, selectedIds),
    canWeldSelection: selectionCanWeld(app.project, selectedIds),
    canUnionSilhouette: unionSilhouetteOperations(app.project.scene, selectedIds).length > 0,
    canJoinPaths: selectionCanJoinPaths(app.project, selectedIds),
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
    canAlignSelection: arrangeUnits >= 2,
    canDistributeSelection: arrangeUnits >= 3,
    canBreakApartSelection: selectionCanBreakApart(app.project, selectedIds),
    focusTestAvailable:
      profileSupportsCapability(app.project.device, 'z-axis') &&
      app.project.device.zTravelConfirmed === true,
    printAndCutFeatureEnabled: dialogs.printAndCutFeatureEnabled,
    printAndCutProfileSupported: dialogs.printAndCutProfileSupported,
    previewActive: app.previewMode,
    hasPreviewableContent: hasPreviewableContent(app.project),
  };
}

function isActiveStreamerStatus(status: string | undefined): boolean {
  // A tool change is an active hold: job-active commands remain blocked while
  // the setup controls needed to continue are gated separately.
  return (
    status !== undefined &&
    ['streaming', 'paused', 'done', 'errored', 'tool-change'].includes(status)
  );
}

function connectionCommandContext(
  app: ReturnType<typeof useStore.getState>,
  laser: ReturnType<typeof useLaserStore.getState>,
  platform: ReturnType<typeof usePlatform>,
  activeStreamer: boolean,
) {
  return {
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
  | 'printAndCut'
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
    addText: dialogs.textTool,
    printAndCut: dialogs.printAndCut,
  };
}

function arrangeCommandContext(
  app: ReturnType<typeof useStore.getState>,
  callbacks: CommandShellCallbacks,
): Pick<
  AppCommandContext,
  | 'alignSelection'
  | 'distributeSelection'
  | 'breakApartSelection'
  | 'flipHorizontal'
  | 'flipVertical'
  | 'createArray'
  | 'quickNest'
> {
  return {
    alignSelection: app.alignSelection,
    distributeSelection: app.distributeSelection,
    breakApartSelection: app.breakApartSelection,
    flipHorizontal: () => app.flipSelection('horizontal'),
    flipVertical: () => app.flipSelection('vertical'),
    createArray: callbacks.requestArray,
    quickNest: callbacks.requestQuickNest,
  };
}

function laserCommandContext(
  platform: ReturnType<typeof usePlatform>,
  laser: ReturnType<typeof useLaserStore.getState>,
): Pick<AppCommandContext, 'connectLaser' | 'disconnectLaser' | 'homeLaser'> {
  return {
    connectLaser: () =>
      void laser.connect(platform, connectOptionsForDevice(useStore.getState().project.device)),
    disconnectLaser: () =>
      void laser.disconnect().catch(controllerActionFailureHandler('Disconnect')),
    homeLaser: () => void laser.home().catch(controllerActionFailureHandler('Home')),
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
