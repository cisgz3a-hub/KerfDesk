import type { Project } from '../../core/scene';
import { usePlatform } from '../app/platform-context';
import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from '../app/file-actions';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { isConvertibleVector } from '../raster/vector-to-bitmap';
import { buildAppCommands, type AppCommand } from './command-registry';

export type CommandShellCallbacks = {
  readonly requestImportImage: () => void;
  readonly requestConvertToBitmap: () => void;
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
  const hasSelection = app.selectedObjectId !== null || app.additionalSelectedIds.size > 0;
  const activeStreamer =
    laser.streamer !== null &&
    (laser.streamer.status === 'streaming' || laser.streamer.status === 'paused');
  const machine = {
    statusReport: laser.statusReport,
    workOriginActive: laser.workOriginActive,
    wcoCache: laser.wcoCache,
  };
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
    confirmDiscard,
    newProject: app.newProject,
    openProject: () => openProject(platform, app.setProject, app.markLoaded, pushToast),
    saveProject: () => saveProject(platform, app, pushToast, false),
    saveProjectAs: () => saveProject(platform, app, pushToast, true),
    importSvg: () => void handleImportSvg(platform, app.importSvgObject, pushToast),
    importImage: callbacks.requestImportImage,
    saveGcode: () =>
      void handleSaveGcode({
        platform,
        project: app.project,
        savedName: app.savedName,
        jobPlacement: app.jobPlacement,
        machine,
        pushToast,
      }),
    undo: app.undo,
    redo: app.redo,
    selectAll: app.selectAllObjects,
    duplicateSelection: app.duplicateSelection,
    deleteSelection: () => deleteSelection(),
    clearSelection: () => app.selectObject(null),
    addText: () => openTextDialog({ mode: 'add' }),
    traceImage: () => {
      if (selected?.kind === 'raster-image') openImageDialog(selected);
    },
    convertToBitmap: callbacks.requestConvertToBitmap,
    canTransformSelection: selected !== null,
    flipHorizontal: () => flipSelected('horizontal'),
    flipVertical: () => flipSelected('vertical'),
    connectLaser: () => void laser.connect(platform),
    disconnectLaser: () => void laser.disconnect().catch(() => undefined),
    homeLaser: () => void laser.home().catch(() => undefined),
    togglePreview: app.togglePreview,
    resetView: useUiStore.getState().resetView,
    showAbout: callbacks.showAbout,
  });
}

function confirmDiscard(action: string): boolean {
  const state = useStore.getState();
  if (!state.dirty) return true;
  const name = state.savedName ?? 'this project';
  return window.confirm(
    `Discard unsaved changes to ${name} and ${action}? (Cancel to keep editing - Save first via Save or Ctrl+S.)`,
  );
}

function openProject(
  platform: ReturnType<typeof usePlatform>,
  setProject: ReturnType<typeof useStore.getState>['setProject'],
  markLoaded: ReturnType<typeof useStore.getState>['markLoaded'],
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): void {
  if (!confirmDiscard('open another project')) return;
  void handleOpenProject({ platform, setProject, markLoaded, pushToast });
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

function deleteSelection(): void {
  const state = useStore.getState();
  const ids = [
    ...(state.selectedObjectId !== null ? [state.selectedObjectId] : []),
    ...state.additionalSelectedIds,
  ];
  for (const id of ids) state.removeSceneObject(id);
}

function flipSelected(axis: 'horizontal' | 'vertical'): void {
  const state = useStore.getState();
  const selected = selectedObject(state.project, state.selectedObjectId);
  if (selected === null) return;
  state.applyObjectTransform(selected.id, {
    ...selected.transform,
    mirrorX: axis === 'horizontal' ? !selected.transform.mirrorX : selected.transform.mirrorX,
    mirrorY: axis === 'vertical' ? !selected.transform.mirrorY : selected.transform.mirrorY,
  });
}
