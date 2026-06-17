import type { Project } from '../../core/scene';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { usePlatform } from '../app/platform-context';
import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from '../app/file-actions';
import { currentOutputScope, useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { isConvertibleVector } from '../raster/vector-to-bitmap';
import { buildAppCommands, type AppCommand } from './command-registry';
import { hasPreviewableContent } from './previewable-content';

export type CommandShellCallbacks = {
  readonly requestImportImage: () => void;
  readonly requestConvertToBitmap: () => void;
  readonly requestAdjustImage: () => void;
  readonly requestMaterialTest: () => void;
  readonly requestIntervalTest: () => void;
  readonly requestScanOffsetTest: () => void;
  readonly requestOptimizationSettings: () => void;
  readonly showAbout: () => void;
};

export function useAppCommands(callbacks: CommandShellCallbacks): ReadonlyArray<AppCommand> {
  const platform = usePlatform();
  const app = useStore();
  const laser = useLaserStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const openTextDialog = useUiStore((s) => s.openTextDialog);
  const openImageDialog = useUiStore((s) => s.openImageDialog);
  const selected = selectedObject(app.project, app.selectedObjectId);
  const selectedIds = selectedObjectIds(app.selectedObjectId, app.additionalSelectedIds);
  const hasSelection = selectedIds.length > 0;
  const activeStreamer =
    laser.streamer !== null &&
    (laser.streamer.status === 'streaming' || laser.streamer.status === 'paused');
  return buildAppCommands({
    dirty: app.dirty,
    savedName: app.savedName,
    serialSupported: platform.serial.isSupported(),
    connected: laser.connection.kind === 'connected',
    machineBusy: laser.autofocusBusy || laser.motionOperation !== null || activeStreamer,
    homingEnabled: app.project.device.homing.enabled,
    canUndo: app.undoStack.length > 0,
    canRedo: app.redoStack.length > 0,
    hasSelection,
    hasRasterSelection: selected?.kind === 'raster-image',
    hasConvertibleSelection: selected !== null && isConvertibleVector(selected),
    confirmDiscard: (action) => confirmDiscardAsync(platform, action),
    newProject: app.newProject,
    openProject: () => openProject(platform, app.setProject, app.markLoaded, pushToast),
    saveProject: () => saveProject(platform, app, pushToast, false),
    saveProjectAs: () => saveProject(platform, app, pushToast, true),
    importSvg: () => void handleImportSvg(platform, app.importSvgObject, pushToast),
    importImage: callbacks.requestImportImage,
    saveGcode: saveGcodeAction(platform, app, laser, pushToast),
    undo: app.undo,
    redo: app.redo,
    selectAll: app.selectAllObjects,
    duplicateSelection: app.duplicateSelection,
    deleteSelection: () => deleteSelection(),
    clearSelection: () => app.selectObject(null),
    addText: () => openTextDialog({ mode: 'add' }),
    materialTest: callbacks.requestMaterialTest,
    intervalTest: callbacks.requestIntervalTest,
    scanOffsetTest: callbacks.requestScanOffsetTest,
    optimizationSettings: callbacks.requestOptimizationSettings,
    adjustImage: callbacks.requestAdjustImage,
    traceImage: () => {
      if (selected?.kind === 'raster-image') openImageDialog(selected);
    },
    convertToBitmap: callbacks.requestConvertToBitmap,
    canTransformSelection: selected !== null,
    canAlignSelection: selectedIds.length >= 2,
    alignSelection: app.alignSelection,
    canDistributeSelection: selectedIds.length >= 3,
    distributeSelection: app.distributeSelection,
    flipHorizontal: () => app.flipSelection('horizontal'),
    flipVertical: () => app.flipSelection('vertical'),
    connectLaser: () => void laser.connect(platform),
    disconnectLaser: () => void laser.disconnect().catch(() => undefined),
    homeLaser: () => void laser.home().catch(() => undefined),
    togglePreview: app.togglePreview,
    previewActive: app.previewMode,
    hasPreviewableContent: hasPreviewableContent(app.project),
    resetView: useUiStore.getState().resetView,
    showAbout: callbacks.showAbout,
  });
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

function deleteSelection(): void {
  const state = useStore.getState();
  const ids = [
    ...(state.selectedObjectId !== null ? [state.selectedObjectId] : []),
    ...state.additionalSelectedIds,
  ];
  state.removeSceneObjects(ids);
}
