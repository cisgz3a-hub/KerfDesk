import type { Project, RasterImage } from '../../core/scene';
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
import { cropMaskedRasterImage } from '../raster/crop-image';
import { buildAppCommands, type AppCommand } from './command-registry';
import type { AppCommandContext } from './command-types';
import { selectedImageMaskPair, type SelectedImageMaskPair } from './image-mask-command-state';
import { hasPreviewableContent } from './previewable-content';

export type CommandShellCallbacks = {
  readonly requestImportImage: () => void;
  readonly requestMultiFileTrace: () => void;
  readonly requestConvertToBitmap: () => void;
  readonly requestAdjustImage: () => void;
  readonly requestMaterialTest: () => void;
  readonly requestIntervalTest: () => void;
  readonly requestScanOffsetTest: () => void;
  readonly requestFocusTest: () => void;
  readonly requestOptimizationSettings: () => void;
  readonly showAbout: () => void;
};

type CommandDialogs = {
  readonly openImageDialog: (source: RasterImage) => void;
  readonly openTextDialog: (options: { readonly mode: 'add' }) => void;
};

type CommandSelection = {
  readonly selected: Project['scene']['objects'][number] | null;
  readonly selectedIds: ReadonlyArray<string>;
  readonly imageMaskPair: SelectedImageMaskPair | null;
};

export function useAppCommands(callbacks: CommandShellCallbacks): ReadonlyArray<AppCommand> {
  const platform = usePlatform();
  const app = useStore();
  const laser = useLaserStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const openTextDialog = useUiStore((s) => s.openTextDialog);
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  return buildAppCommands(
    appCommandContext(callbacks, platform, app, laser, pushToast, {
      openImageDialog,
      openTextDialog,
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
    (laser.streamer.status === 'streaming' || laser.streamer.status === 'paused');
  return {
    ...fileCommandContext(callbacks, platform, app, laser, pushToast),
    ...editCommandContext(app, dialogs),
    ...toolCommandContext(callbacks, app, platform, dialogs, pushToast, selection),
    ...arrangeCommandContext(app),
    ...laserCommandContext(platform, laser),
    ...windowHelpCommandContext(callbacks, app),
    dirty: app.dirty,
    savedName: app.savedName,
    serialSupported: platform.serial.isSupported(),
    connected: laser.connection.kind === 'connected',
    machineBusy: laser.autofocusBusy || laser.motionOperation !== null || activeStreamer,
    homingEnabled: app.project.device.homing.enabled,
    hasSelection: selectedIds.length > 0,
    hasRasterSelection: selected?.kind === 'raster-image',
    hasConvertibleSelection: selected !== null && isConvertibleVector(selected),
    canApplyImageMask: imageMaskPair !== null,
    hasMaskedRasterSelection,
    canPaste: app.sceneClipboard !== null && app.sceneClipboard.objects.length > 0,
    canGroupSelection: selectedIds.length >= 2,
    canUngroupSelection: selectionTouchesGroup(app.project, selectedIds),
    canLockSelection: selectionHasUnlockedObject(app.project, selectedIds),
    hasLockedObjects: app.project.scene.objects.some((object) => object.locked === true),
    canTransformSelection: selected !== null,
    canAlignSelection: selectedIds.length >= 2,
    canDistributeSelection: selectedIds.length >= 3,
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
  | 'multiFileTrace'
  | 'convertToBitmap'
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
    multiFileTrace: callbacks.requestMultiFileTrace,
    convertToBitmap: callbacks.requestConvertToBitmap,
    applyImageMask: applyImageMaskAction(app, selection.imageMaskPair),
    cropImage: cropImageAction(app, selection.selected, pushToast),
    removeImageMask: removeImageMaskAction(app, selection.selected),
  };
}

function arrangeCommandContext(
  app: ReturnType<typeof useStore.getState>,
): Pick<
  AppCommandContext,
  'alignSelection' | 'distributeSelection' | 'flipHorizontal' | 'flipVertical'
> {
  return {
    alignSelection: app.alignSelection,
    distributeSelection: app.distributeSelection,
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
): Pick<AppCommandContext, 'togglePreview' | 'resetView' | 'showAbout'> {
  return {
    togglePreview: app.togglePreview,
    resetView: useUiStore.getState().resetView,
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

function traceImageAction(
  selected: Project['scene']['objects'][number] | null,
  openImageDialog: (source: RasterImage) => void,
): () => void {
  return () => {
    if (selected?.kind === 'raster-image') openImageDialog(selected);
  };
}

function applyImageMaskAction(
  app: ReturnType<typeof useStore.getState>,
  pair: SelectedImageMaskPair | null,
): () => void {
  return () => {
    if (pair !== null) app.applyImageMask(pair.imageId, pair.maskId);
  };
}

function removeImageMaskAction(
  app: ReturnType<typeof useStore.getState>,
  selected: Project['scene']['objects'][number] | null,
): () => void {
  return () => {
    if (selected?.kind === 'raster-image') app.removeImageMask(selected.id);
  };
}

function cropImageAction(
  app: ReturnType<typeof useStore.getState>,
  selected: Project['scene']['objects'][number] | null,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): () => void {
  return () => {
    if (selected?.kind !== 'raster-image' || selected.imageMaskId === undefined) return;
    const maskObject = app.project.scene.objects.find(
      (object) => object.id === selected.imageMaskId,
    );
    void cropMaskedRasterImage(selected, maskObject)
      .then((cropped) => {
        app.cropImage(selected.id, cropped);
        pushToast(`Cropped image: ${selected.source}`, 'success');
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        pushToast(`Could not crop image: ${message}`, 'error');
      });
  };
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

function selectedObject(project: Project, selectedObjectId: string | null) {
  if (selectedObjectId === null) return null;
  return project.scene.objects.find((object) => object.id === selectedObjectId) ?? null;
}

function selectedObjectIds(
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  return [...(selectedObjectId === null ? [] : [selectedObjectId]), ...additionalSelectedIds];
}

function selectionTouchesGroup(project: Project, selectedIds: ReadonlyArray<string>): boolean {
  const selected = new Set(selectedIds);
  return (project.scene.groups ?? []).some((group) =>
    group.objectIds.some((objectId) => selected.has(objectId)),
  );
}

function selectionHasUnlockedObject(project: Project, selectedIds: ReadonlyArray<string>): boolean {
  const selected = new Set(selectedIds);
  return project.scene.objects.some((object) => selected.has(object.id) && object.locked !== true);
}

function deleteSelection(): void {
  const state = useStore.getState();
  const ids = [
    ...(state.selectedObjectId !== null ? [state.selectedObjectId] : []),
    ...state.additionalSelectedIds,
  ];
  state.removeSceneObjects(ids);
}
