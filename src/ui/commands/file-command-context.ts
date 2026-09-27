import { confirmDiscardAsync } from '../app/confirm-discard';
import { handleImportDxf, handleImportSvg, handleSaveProject } from '../app/file-actions';
import {
  inspectCurrentGcodeAction,
  openGcodeInspectorAction,
  type GcodeActionDeps,
} from './gcode-command-actions';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { handleUnifiedArtworkImport } from '../app/import-dispatch';
import { openProjectCommand } from './open-project-command';
import { openTemplateCommand, saveTemplateCommand } from './template-command-actions';
import { handleImportHeightMaps } from '../app/height-map-import-action';
import { handleExportArtworkDxf } from '../app/export-artwork-dxf';
import { handleExportArtworkSvg } from '../app/export-artwork-svg';
import type { PlatformAdapter } from '../../platform/types';
import type { CommandShellCallbacks } from './app-command-context-types';
import type { AppCommandContext } from './command-types';
import { selectedObjectIds } from './selection-command-state';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import type { useToastStore } from '../state/toast-store';

type FileCommandContext = Pick<
  AppCommandContext,
  | 'confirmDiscard'
  | 'newProject'
  | 'openProject'
  | 'saveProject'
  | 'saveProjectAs'
  | 'openTemplate'
  | 'saveTemplate'
  | 'importArtwork'
  | 'importSvg'
  | 'importDxf'
  | 'importImage'
  | 'importHeightMap'
  | 'saveGcode'
  | 'exportSvg'
  | 'exportDxf'
  | 'openGcodePreview'
  | 'inspectCurrentGcode'
>;

export function fileCommandContext(
  callbacks: CommandShellCallbacks,
  platform: PlatformAdapter,
  app: ReturnType<typeof useStore.getState>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): FileCommandContext {
  // Save and the Inspector compile from the stores as they stand at CLICK
  // time, not from the render that built this context. Reading them here is
  // what lets the command surface skip the status-poll and mousemove
  // re-renders that used to be the only thing keeping a captured snapshot
  // current (use-command-store-state).
  const gcodeDeps = (): GcodeActionDeps => ({
    platform,
    app: useStore.getState(),
    laser: useLaserStore.getState(),
    pushToast,
    openInspector: callbacks.requestGcodeInspector,
  });
  return {
    confirmDiscard: (action) => confirmDiscardAsync(platform, action),
    newProject: app.newProject,
    openProject: () => void openProjectCommand(platform, pushToast),
    saveProject: () => saveProject(platform, useStore.getState(), pushToast, false),
    saveProjectAs: () => saveProject(platform, useStore.getState(), pushToast, true),
    openTemplate: () => void openTemplateCommand(platform, pushToast),
    saveTemplate: () => void saveTemplateCommand(platform, pushToast),
    importArtwork: () =>
      void handleUnifiedArtworkImport(platform, {
        getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
        importSvgObject: app.importSvgObject,
        importSvgFragment: app.importSvgFragment,
        importRasterImage: app.importRasterImage,
        pushToast,
      }),
    importSvg: () =>
      void handleImportSvg(
        platform,
        app.importSvgObject,
        pushToast,
        () => useStore.getState().projectDocumentEpoch,
        app.importSvgFragment,
      ),
    importDxf: () =>
      void handleImportDxf(
        platform,
        app.importSvgObject,
        pushToast,
        () => useStore.getState().projectDocumentEpoch,
      ),
    importImage: callbacks.requestImportImage,
    importHeightMap: () => {
      const current = useStore.getState();
      void handleImportHeightMaps(platform, {
        getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
        importObject: current.importSvgObject,
        pushToast,
      });
    },
    saveGcode: () => useUiStore.getState().openGcodeSaveDialog(),
    exportSvg: () => {
      const current = useStore.getState();
      void handleExportArtworkSvg({
        platform,
        project: current.project,
        selectedIds: selectedObjectIds(current.selectedObjectId, current.additionalSelectedIds),
        savedName: current.savedName,
        pushToast,
      });
    },
    exportDxf: () => {
      const current = useStore.getState();
      void handleExportArtworkDxf({
        platform,
        project: current.project,
        selectedIds: selectedObjectIds(current.selectedObjectId, current.additionalSelectedIds),
        savedName: current.savedName,
        pushToast,
      });
    },
    openGcodePreview: () => openGcodeInspectorAction(gcodeDeps())(),
    inspectCurrentGcode: () => inspectCurrentGcodeAction(gcodeDeps())(),
  };
}

function saveProject(
  platform: PlatformAdapter,
  app: ReturnType<typeof useStore.getState>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
  forceDialog: boolean,
): void {
  void handleSaveProject(
    {
      platform,
      project: projectWithCurrentJobSetup(app),
      expectedProject: app.project,
      projectDocumentEpoch: app.projectDocumentEpoch,
      getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
      claimProjectSaveRequest: app.claimProjectSaveRequest,
      getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
      projectSaveWriteCoordinator: app.projectSaveWriteCoordinator,
      savedName: app.savedName,
      lastSaveTarget: app.lastSaveTarget,
      markSaved: app.markSaved,
      markProjectSaveUncertain: app.markProjectSaveUncertain,
      pushToast,
    },
    forceDialog,
  );
}
