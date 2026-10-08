import type { AppState } from './store';
import { createStartupProject } from './startup-project';
import { initialProjectWorkspaceState } from './store-initial-project-state';
import { CNC_LIBRARY_STATE_DEFAULTS } from './cnc-library-actions';
import { DEFAULT_LAYER_DEFAULTS_STATE } from './layer-default-actions';
import {
  MATERIAL_LIBRARY_STATE_DEFAULTS,
  type currentMaterialLibraryState,
} from './material-library-actions';
import {
  SAVED_LIBRARIES_STATE_DEFAULTS,
  type currentSavedLibrariesState,
} from './saved-libraries-actions';
export const initialState = (
  project = createStartupProject(),
): Pick<
  AppState,
  | 'project'
  | 'projectDocumentEpoch'
  | 'projectOpenRequestEpoch'
  | 'projectSaveRequestEpoch'
  | 'projectSavedRequestEpoch'
  | 'projectSaveWriteCoordinator'
  | 'probeSetupEpoch'
  | 'cachedCncMachine'
  | 'projectBedReconciliation'
  | 'cncLiveCaps'
  | 'selectedObjectId'
  | 'selectedPathNode'
  | 'selectedPathNodes'
  | 'additionalSelectedIds'
  | 'previewMode'
  | 'cncLibrary'
  | 'externalGcodePreview'
  | 'undoStack'
  | 'redoStack'
  | 'pendingUndo'
  | 'cursorMm'
  | 'jobPlacement'
  | 'outputScopeSettings'
  | 'registrationArtworkOutputSnapshot'
  | 'dirty'
  | 'savedName'
  | 'lastSaveTarget'
  | 'copiedLayerSettings'
  | 'sceneClipboard'
  | 'layerDefaults'
> &
  ReturnType<typeof currentMaterialLibraryState> &
  ReturnType<typeof currentSavedLibrariesState> => ({
  ...initialProjectWorkspaceState(project),
  ...CNC_LIBRARY_STATE_DEFAULTS,
  layerDefaults: DEFAULT_LAYER_DEFAULTS_STATE,
  ...MATERIAL_LIBRARY_STATE_DEFAULTS,
  ...SAVED_LIBRARIES_STATE_DEFAULTS,
});
