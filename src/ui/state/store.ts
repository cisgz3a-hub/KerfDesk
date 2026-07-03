// Zustand store: active Project + UI state (selection, preview toggle) +
// undo/redo history (F-A14) + dirty/save tracking (F-A11). Each action is
// built as a slice factory below so the `create` call stays small enough
// to satisfy ADR-015's function-size rule.

import { create } from 'zustand';
import type { BoxPanel } from '../../core/box';
import type { DeviceProfile } from '../../core/devices';
import {
  createProject,
  type Layer,
  type LayerMoveDirection,
  type OutputScope,
  type Project,
  type RasterImage,
  type Scene,
  type SceneObject,
  type ShapeObject,
  type TextObject,
  type TracedImage,
  type Transform,
  type Vec2,
} from '../../core/scene';
import type { Toolpath } from '../../core/job';
import type { SaveTarget } from '../../platform/types';
import { DEFAULT_JOB_PLACEMENT, type JobPlacementSettings } from '../job-placement';
import { imageImportActions } from './import-actions';
import { machineActions, type MachineActions } from './machine-actions';
import type { CncMachineConfig } from '../../core/scene';
import { breakApartActions, type BreakApartActions } from './break-apart-actions';
import {
  rasterAdjustmentActions,
  type RasterImageAdjustmentPatch,
} from './raster-adjustment-actions';
import { reliefParamActions, type ReliefParamPatch } from './relief-param-actions';
import { externalGcodeActions, type ExternalGcodePreview } from './external-gcode-actions';
import {
  CNC_LIBRARY_STATE_DEFAULTS,
  cncLibraryActions,
  type CncLibraryActions,
} from './cnc-library-actions';
import type { CncLibrary } from './cnc-library-persistence';
import {
  layerActions,
  type LayerSettingsClipboard,
  type LayerSubLayerPatch,
} from './layer-actions';
import { fillSelectionActions, type FillSelectionActions } from './fill-selection-actions';
import { vectorPathActions, type VectorPathActions } from './vector-path-actions';
import {
  closeOpenFillContoursActions,
  type CloseOpenFillContoursActions,
} from './close-open-fill-contours-actions';
import {
  DEFAULT_LAYER_DEFAULTS_STATE,
  layerDefaultActions,
  type LayerDefaultsState,
} from './layer-default-actions';
import {
  MATERIAL_LIBRARY_STATE_DEFAULTS,
  currentMaterialLibraryState,
  materialLibraryActions,
  type MaterialLibraryActions,
} from './material-library-actions';
import {
  SAVED_LIBRARIES_STATE_DEFAULTS,
  currentSavedLibrariesState,
  savedLibrariesActions,
  type SavedLibrariesActions,
} from './saved-libraries-actions';
import { materialPresetActions, type MaterialPresetActions } from './material-preset-actions';
import { objectPropertiesActions, type ObjectPropertiesActions } from './object-properties-actions';
import { imageMaskActions, type ImageMaskActions } from './image-mask-actions';
import {
  sceneClipboardActions,
  type SceneClipboard,
  type SceneClipboardActions,
} from './scene-clipboard-actions';
import { sceneGroupActions, type SceneGroupActions } from './scene-group-actions';
import { sceneLockActions, type SceneLockActions } from './scene-lock-actions';
import { generatedSceneActions } from './generated-scene-actions';
import {
  projectOptimizationActions,
  type ProjectOptimizationActions,
} from './project-optimization-actions';
import { projectNotesActions, type ProjectNotesActions } from './project-notes-actions';
import {
  selectionTransformActions,
  type SelectionTransformActions,
} from './selection-transform-actions';
import {
  registrationOutputActions,
  type RegistrationOutputActions,
} from './registration-output-actions';
import {
  pathNodeEditActions,
  type PathNodeEditActions,
  type PathNodeRef,
} from './path-node-edit-actions';
import { type ImportOutcome, type TraceExistingImageOptions } from './scene-mutations';
import { objectInsertActions } from './object-insert-actions';
import { objectDeleteActions, type ObjectDeleteActions } from './object-delete-actions';
import {
  duplicateAction,
  fitToSelectionAction,
  historyActions,
  interactionActions,
  saveTrackingActions,
  sceneActions,
  viewActions,
} from './store-actions';

export type { ImportOutcome } from './scene-mutations';

export type OutputScopeSettings = {
  readonly cutSelectedGraphics: boolean;
  readonly useSelectionOrigin: boolean;
};

export const DEFAULT_OUTPUT_SCOPE_SETTINGS: OutputScopeSettings = {
  cutSelectedGraphics: false,
  useSelectionOrigin: false,
};

export type AppState = ObjectPropertiesActions &
  ImageMaskActions &
  ProjectOptimizationActions &
  ProjectNotesActions &
  SelectionTransformActions &
  RegistrationOutputActions &
  PathNodeEditActions &
  BreakApartActions &
  FillSelectionActions &
  VectorPathActions &
  CloseOpenFillContoursActions &
  ObjectDeleteActions &
  SceneClipboardActions &
  SceneGroupActions &
  SceneLockActions &
  ReturnType<typeof currentMaterialLibraryState> &
  MaterialLibraryActions &
  ReturnType<typeof currentSavedLibrariesState> &
  SavedLibrariesActions &
  MaterialPresetActions &
  CncLibraryActions &
  MachineActions & {
    readonly project: Project;
    // Last CNC machine setup, kept when toggling back to laser so the
    // choice of bit/stock survives a round-trip within the session.
    readonly cachedCncMachine: CncMachineConfig | null;
    readonly selectedObjectId: string | null;
    readonly selectedPathNode: PathNodeRef | null;
    readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
    // Additional objects in the multi-selection set (F-A5). The "primary"
    // selection is selectedObjectId; additionalSelectedIds is everything
    // shift+clicked or marquee-added after that. Combined-bbox scale and
    // rotate are intentionally Phase C — Phase A's transform pipeline only
    // operates on the primary selection. Move + Delete are multi-aware.
    readonly additionalSelectedIds: ReadonlySet<string>;
    readonly previewMode: boolean;
    // App-level CNC library (H.7): custom bits, feed presets, machine
    // profiles. Restored/persisted by use-cnc-library-persistence.
    readonly cncLibrary: CncLibrary;
    // External .nc program shown in the simulator instead of the compiled
    // job (H.6b); cleared when Preview exits. Session-only, never persisted.
    readonly externalGcodePreview: ExternalGcodePreview | null;
    readonly openExternalGcodePreview: (name: string, toolpath: Toolpath) => void;
    readonly closeExternalGcodePreview: () => void;
    readonly undoStack: ReadonlyArray<Project>;
    readonly redoStack: ReadonlyArray<Project>;
    readonly pendingUndo: Project | null;
    // Cursor position over the workspace canvas in scene-mm coords, or null
    // when the pointer isn't over the canvas. Updated at mousemove cadence;
    // only the StatusBar subscribes to it, so re-render fan-out is bounded.
    readonly cursorMm: Vec2 | null;
    readonly jobPlacement: JobPlacementSettings;
    readonly outputScopeSettings: OutputScopeSettings;
    readonly registrationArtworkOutputSnapshot: Readonly<Record<string, boolean>> | null;
    // F-A11 dirty / save tracking. `dirty` flips true on every mutating
    // action; flips false on a successful save. `savedName` is the file the
    // project was last saved as — drives the window title. `lastSaveTarget`
    // holds the platform's SaveTarget so Ctrl+S after a first save writes
    // through without re-prompting; cleared by New/Open.
    readonly dirty: boolean;
    readonly savedName: string | null;
    readonly lastSaveTarget: SaveTarget | null;
    readonly copiedLayerSettings: LayerSettingsClipboard | null;
    readonly sceneClipboard: SceneClipboard | null;
    readonly layerDefaults: LayerDefaultsState;

    readonly setProject: (project: Project) => void;
    readonly newProject: () => void;
    readonly replaceSceneWithGeneratedScene: (scene: Scene) => void;

    // batchOffsetIdx (default 0) shifts the imported object by 10mm × N to the
    // right and down (F-A3 multi-import). The first file in a batch passes 0,
    // the second passes 1, etc., so a 3-file drop produces a stagger instead
    // of fully-overlapping designs.
    //
    // Returns an ImportOutcome so callers can toast the diff (Phase C
    // re-import). For a fresh add the outcome is `{ kind: 'added' }`;
    // for a re-import (existing object with matching source filename
    // found) it's `{ kind: 'replaced', kept, added, removed }`.
    readonly importSvgObject: (object: SceneObject, batchOffsetIdx?: number) => ImportOutcome;
    // Raster bitmap import + ADR-026 trace-on-selection — both in import-actions.ts.
    readonly importRasterImage: (object: SceneObject, batchIdx?: number) => void;
    // Overlay a vector trace onto an already-imported bitmap (the Trace tool).
    readonly traceExistingImage: (
      sourceId: string,
      traced: TracedImage,
      options?: TraceExistingImageOptions,
    ) => void;
    // ADR-029 Convert to Bitmap: replace a selected vector with the raster
    // engrave-source rasterized from it (LightBurn discards the original).
    readonly convertToBitmap: (sourceId: string, raster: RasterImage) => void;
    // Phase D insert / update text by id; on add it's a new id, on
    // edit it replaces in place (preserves position/transform).
    readonly upsertTextObject: (text: TextObject) => void;
    // Phase G (ADR-051): commit a kind:'shape' object drawn on the canvas.
    readonly drawShape: (shape: ShapeObject) => void;
    // Phase K (ADR-105): insert a generated box panel sheet — one polyline
    // shape per panel, one undo step, every panel selected.
    readonly insertBoxPanels: (panels: ReadonlyArray<BoxPanel>) => void;
    // ADR-057: add (or replace) the registration jig box on the reserved
    // registration layer. Width/height in mm; a new box centers on the bed, a
    // replace keeps the existing box's position and lock state.
    readonly addRegistrationBox: (widthMm: number, heightMm: number) => void;
    // ADR-057: add (or replace) a circular registration jig outline for round
    // blanks. Diameter in mm; replacement keeps position and lock state.
    readonly addRegistrationCircle: (diameterMm: number) => void;
    // ADR-057: delete the jig box(es) and the reserved registration layer. No-op
    // when no jig is present.
    readonly removeRegistrationBox: () => void;
    // ADR-057: lock/unlock the jig box so it can't drift between the two burns
    // once the operator has positioned it.
    readonly setRegistrationBoxLocked: (locked: boolean) => void;
    // Clone every currently-selected SceneObject with a fresh id and a
    // 10 mm offset (matches the F-A3 multi-import stagger). Becomes the
    // new selection. No-op when nothing is selected.
    readonly duplicateSelection: () => void;
    // Zoom to current selection's bounds; falls back to fit-all then
    // bed-fit. Driven by Shift+F and the fit-to-selection zoom button.
    readonly fitToSelection: () => void;
    readonly setLayerParam: (layerId: string, patch: Partial<Omit<Layer, 'id' | 'color'>>) => void;
    readonly moveLayer: (layerId: string, direction: LayerMoveDirection) => void;
    readonly createManualLayer: (color: string) => void;
    readonly switchIslandFillLayersToScanline: () => void;
    readonly assignSelectionToLayer: (layerId: string) => void;
    readonly breakApartSelection: () => void;
    readonly fillSelectionSeparately: () => void;
    readonly convertSelectionToPath: () => void;
    readonly weldSelection: () => void;
    readonly closeSelectedOpenFillContours: () => void;
    readonly closeSelectedOpenFillContoursWithTolerance: (toleranceMm: number) => void;
    readonly deleteLayerAndObjects: (layerId: string) => void;
    readonly copyLayerSettings: (layerId: string) => void;
    readonly pasteLayerSettings: (layerId: string) => void;
    readonly addLayerSubLayer: (layerId: string) => void;
    readonly updateLayerSubLayer: (
      layerId: string,
      subLayerId: string,
      patch: LayerSubLayerPatch,
    ) => void;
    readonly deleteLayerSubLayer: (layerId: string, subLayerId: string) => void;
    readonly makeLayerDefault: (layerId: string) => void;
    readonly makeLayerDefaultForAll: (layerId: string) => void;
    readonly resetLayerToDefault: (layerId: string) => void;
    readonly setLayerDefaults: (layerDefaults: LayerDefaultsState) => void;
    readonly setRasterImageAdjustments: (id: string, patch: RasterImageAdjustmentPatch) => void;
    readonly setReliefParams: (id: string, patch: ReliefParamPatch) => void;
    readonly updateDeviceProfile: (patch: Partial<DeviceProfile>) => void;
    readonly replaceDeviceProfile: (profile: DeviceProfile) => void;

    readonly undo: () => void;
    readonly redo: () => void;

    // Single-select on plain click; clears all when id is null.
    readonly selectObject: (id: string | null) => void;
    // Shift+click toggle; never clears the primary.
    readonly toggleSelectObject: (id: string) => void;
    // Ctrl+A: primary = first, additional = rest.
    readonly selectAllObjects: () => void;
    readonly selectObjects: (
      ids: ReadonlyArray<string>,
      options?: { readonly additive?: boolean },
    ) => void;
    readonly selectObjectsOnLayer: (layerId: string) => void;
    readonly togglePreview: () => void;
    readonly setJobPlacement: (patch: Partial<JobPlacementSettings>) => void;
    readonly setOutputScopeSettings: (patch: Partial<OutputScopeSettings>) => void;
    readonly setCursorMm: (cursor: Vec2 | null) => void;

    readonly beginInteraction: () => void;
    readonly setObjectTransform: (id: string, transform: Transform) => void;
    readonly endInteraction: () => void;
    readonly applyObjectTransform: (id: string, transform: Transform) => void;

    readonly markSaved: (target: SaveTarget) => void;
    readonly markLoaded: (filename: string) => void;
  };

type Setter = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;

function initialState(): Pick<
  AppState,
  | 'project'
  | 'cachedCncMachine'
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
  ReturnType<typeof currentSavedLibrariesState> {
  return {
    project: createProject(),
    cachedCncMachine: null,
    selectedObjectId: null,
    selectedPathNode: null,
    selectedPathNodes: [],
    additionalSelectedIds: new Set(),
    previewMode: false,
    ...CNC_LIBRARY_STATE_DEFAULTS,
    externalGcodePreview: null,
    undoStack: [],
    redoStack: [],
    pendingUndo: null,
    cursorMm: null,
    jobPlacement: DEFAULT_JOB_PLACEMENT,
    outputScopeSettings: DEFAULT_OUTPUT_SCOPE_SETTINGS,
    registrationArtworkOutputSnapshot: null,
    // Fresh project is clean — no edits have happened, no name on disk.
    dirty: false,
    savedName: null,
    lastSaveTarget: null,
    copiedLayerSettings: null,
    sceneClipboard: null,
    layerDefaults: DEFAULT_LAYER_DEFAULTS_STATE,
    ...MATERIAL_LIBRARY_STATE_DEFAULTS,
    ...SAVED_LIBRARIES_STATE_DEFAULTS,
  };
}

function currentLayerDefaultsState(
  state: Pick<AppState, 'layerDefaults'>,
): Pick<AppState, 'layerDefaults'> {
  return { layerDefaults: state.layerDefaults };
}

// The CNC library is app-level (H.7) — like the material library, it must
// survive New Project / Open.
function currentCncLibraryState(state: Pick<AppState, 'cncLibrary'>): Pick<AppState, 'cncLibrary'> {
  return { cncLibrary: state.cncLibrary };
}

function projectActions(set: Setter): Pick<AppState, 'setProject' | 'newProject'> {
  return {
    setProject: (project) =>
      set((s) => ({
        ...initialState(),
        project,
        ...currentMaterialLibraryState(s),
        ...currentSavedLibrariesState(s),
        ...currentLayerDefaultsState(s),
        ...currentCncLibraryState(s),
      })),
    newProject: () =>
      set((s) => ({
        ...initialState(),
        ...currentMaterialLibraryState(s),
        ...currentSavedLibrariesState(s),
        ...currentLayerDefaultsState(s),
        ...currentCncLibraryState(s),
      })),
  };
}

export function currentOutputScope(state: AppState): OutputScope {
  return {
    cutSelectedGraphics: state.outputScopeSettings.cutSelectedGraphics,
    useSelectionOrigin: state.outputScopeSettings.useSelectionOrigin,
    selectedObjectIds: [
      ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
      ...state.additionalSelectedIds,
    ],
  };
}

export const useStore = create<AppState>((set, get) => ({
  ...initialState(),
  ...projectActions(set),
  ...objectInsertActions(set, get),
  ...imageImportActions(set, get),
  ...breakApartActions(set),
  ...rasterAdjustmentActions(set),
  ...reliefParamActions(set),
  ...externalGcodeActions(set),
  ...cncLibraryActions(set),
  ...layerActions(set),
  ...machineActions(set),
  ...fillSelectionActions(set),
  ...vectorPathActions(set),
  ...closeOpenFillContoursActions(set),
  ...layerDefaultActions(set),
  ...materialLibraryActions(set),
  ...savedLibrariesActions(set, get),
  ...materialPresetActions(set),
  ...objectPropertiesActions(set),
  ...imageMaskActions(set),
  ...sceneClipboardActions(set),
  ...sceneGroupActions(set),
  ...sceneLockActions(set),
  ...generatedSceneActions(set),
  ...projectOptimizationActions(set),
  ...projectNotesActions(set),
  ...selectionTransformActions(set),
  ...registrationOutputActions(set),
  ...pathNodeEditActions(set),
  ...objectDeleteActions(set),
  ...sceneActions(set),
  ...duplicateAction(set),
  ...fitToSelectionAction(get),
  ...historyActions(set),
  ...viewActions(set),
  ...interactionActions(set),
  ...saveTrackingActions(set),
}));
