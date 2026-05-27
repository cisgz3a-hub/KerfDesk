// Zustand store: active Project + UI state (selection, preview toggle) +
// undo/redo history (F-A14) + dirty/save tracking (F-A11). Each action is
// built as a slice factory below so the `create` call stays small enough
// to satisfy ADR-015's function-size rule.

import { create } from 'zustand';
import type { DeviceProfile } from '../../core/devices';
import {
  createProject,
  type Layer,
  type Project,
  removeObject,
  type SceneObject,
  type TextObject,
  type Transform,
  updateLayer,
  type Vec2,
} from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import {
  applyFreshImport,
  applyReimport,
  applyUpsertText,
  findReimportTarget,
  type ImportOutcome,
  pruneOrphanLayers,
  pushUndo,
} from './scene-mutations';

export type { ImportOutcome } from './scene-mutations';

const HISTORY_DEPTH = 50;

export type AppState = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  // Additional objects in the multi-selection set (F-A5). The "primary"
  // selection is selectedObjectId; additionalSelectedIds is everything
  // shift+clicked or marquee-added after that. Combined-bbox scale and
  // rotate are intentionally Phase C — Phase A's transform pipeline only
  // operates on the primary selection. Move + Delete are multi-aware.
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly previewMode: boolean;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly pendingUndo: Project | null;
  // Cursor position over the workspace canvas in scene-mm coords, or null
  // when the pointer isn't over the canvas. Updated at mousemove cadence;
  // only the StatusBar subscribes to it, so re-render fan-out is bounded.
  readonly cursorMm: Vec2 | null;
  // F-A11 dirty / save tracking. `dirty` flips true on every mutating
  // action; flips false on a successful save. `savedName` is the file the
  // project was last saved as — drives the window title. `lastSaveTarget`
  // holds the platform's SaveTarget so Ctrl+S after a first save writes
  // through without re-prompting; cleared by New/Open.
  readonly dirty: boolean;
  readonly savedName: string | null;
  readonly lastSaveTarget: SaveTarget | null;

  readonly setProject: (project: Project) => void;
  readonly newProject: () => void;

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
  // Phase D — insert or update a TextObject by id. The dialog's
  // Submit always calls this; on add it's a new id, on edit it
  // matches an existing id and replaces in place (preserves the
  // user's position/transform).
  readonly upsertTextObject: (text: TextObject) => void;
  readonly removeSceneObject: (id: string) => void;
  readonly setLayerParam: (layerId: string, patch: Partial<Omit<Layer, 'id' | 'color'>>) => void;
  readonly updateDeviceProfile: (patch: Partial<DeviceProfile>) => void;

  readonly undo: () => void;
  readonly redo: () => void;

  // Single-select: replaces both primary + additional with `id` (or clears
  // all when `id` is null). Used by plain clicks.
  readonly selectObject: (id: string | null) => void;
  // Multi-select toggle: shift+click. Adds/removes `id` from the selection
  // set; never clears the primary.
  readonly toggleSelectObject: (id: string) => void;
  // Select-all: F-A5 / F-A15 Ctrl+A. Primary becomes the first object;
  // additional gets the rest.
  readonly selectAllObjects: () => void;
  readonly togglePreview: () => void;
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
  | 'selectedObjectId'
  | 'additionalSelectedIds'
  | 'previewMode'
  | 'undoStack'
  | 'redoStack'
  | 'pendingUndo'
  | 'cursorMm'
  | 'dirty'
  | 'savedName'
  | 'lastSaveTarget'
> {
  return {
    project: createProject(),
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    previewMode: false,
    undoStack: [],
    redoStack: [],
    pendingUndo: null,
    cursorMm: null,
    // Fresh project is clean — no edits have happened, no name on disk.
    dirty: false,
    savedName: null,
    lastSaveTarget: null,
  };
}

function projectActions(set: Setter): Pick<AppState, 'setProject' | 'newProject'> {
  return {
    setProject: (project) => set({ ...initialState(), project }),
    newProject: () => set(initialState()),
  };
}

function importSvgObjectAction(
  set: Setter,
  get: () => AppState,
): Pick<AppState, 'importSvgObject' | 'upsertTextObject'> {
  return {
    importSvgObject: (object, batchOffsetIdx = 0): ImportOutcome => {
      const existing = findReimportTarget(get().project.scene, object);
      let outcome: ImportOutcome = { kind: 'added' };
      set((s) => {
        if (existing !== null && object.kind === 'imported-svg') {
          const next = applyReimport(s, existing, object);
          outcome = next.outcome;
          return next.state;
        }
        return applyFreshImport(s, object, batchOffsetIdx);
      });
      return outcome;
    },
    upsertTextObject: (text) => {
      set((s) => applyUpsertText(s, text));
    },
  };
}

function sceneActions(
  set: Setter,
): Pick<AppState, 'removeSceneObject' | 'setLayerParam' | 'updateDeviceProfile'> {
  return {
    removeSceneObject: (id) =>
      set((s) => {
        // Clear `id` from BOTH the primary and the multi-select extras so
        // a deleted object can't linger as a ghost selection.
        const nextExtras = new Set(s.additionalSelectedIds);
        nextExtras.delete(id);
        // Drop orphan layers — those whose color is no longer
        // referenced by any remaining object. Without this the
        // Cuts/Layers panel keeps a row (with its stale
        // power/speed/passes) for the deleted object's color,
        // which clutters the UI and confuses re-imports later.
        const afterRemove = removeObject(s.project.scene, id);
        const scene = pruneOrphanLayers(afterRemove);
        return {
          project: { ...s.project, scene },
          selectedObjectId: s.selectedObjectId === id ? null : s.selectedObjectId,
          additionalSelectedIds: nextExtras,
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    setLayerParam: (layerId, patch) =>
      set((s) => ({
        project: {
          ...s.project,
          scene: updateLayer(s.project.scene, layerId, patch),
        },
        undoStack: pushUndo(s.project, s.undoStack),
        redoStack: [],
        dirty: true,
      })),
    updateDeviceProfile: (patch) =>
      set((s) => {
        const nextDevice: DeviceProfile = { ...s.project.device, ...patch };
        // When the bed dimensions change, keep the workspace in sync.
        const nextWorkspace =
          patch.bedWidth !== undefined || patch.bedHeight !== undefined
            ? {
                ...s.project.workspace,
                width: nextDevice.bedWidth,
                height: nextDevice.bedHeight,
              }
            : s.project.workspace;
        return {
          project: { ...s.project, device: nextDevice, workspace: nextWorkspace },
          undoStack: pushUndo(s.project, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function historyActions(set: Setter): Pick<AppState, 'undo' | 'redo'> {
  return {
    undo: () =>
      set((s) => {
        const prev = s.undoStack[s.undoStack.length - 1];
        if (prev === undefined) return s;
        return {
          project: prev,
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack, s.project].slice(-HISTORY_DEPTH),
          selectedObjectId: null,
          dirty: true,
        };
      }),
    redo: () =>
      set((s) => {
        const next = s.redoStack[s.redoStack.length - 1];
        if (next === undefined) return s;
        return {
          project: next,
          redoStack: s.redoStack.slice(0, -1),
          undoStack: [...s.undoStack, s.project].slice(-HISTORY_DEPTH),
          selectedObjectId: null,
          dirty: true,
        };
      }),
  };
}

function viewActions(
  set: Setter,
): Pick<
  AppState,
  'selectObject' | 'toggleSelectObject' | 'selectAllObjects' | 'togglePreview' | 'setCursorMm'
> {
  return {
    selectObject: (id) => set({ selectedObjectId: id, additionalSelectedIds: new Set() }),
    toggleSelectObject: (id) =>
      set((s) => {
        // If `id` is the current primary and there are no extras: clear all.
        if (s.selectedObjectId === id && s.additionalSelectedIds.size === 0) {
          return { selectedObjectId: null, additionalSelectedIds: new Set() };
        }
        // If `id` is the primary and there ARE extras: promote one of the
        // extras to primary so the user can keep multi-selecting.
        if (s.selectedObjectId === id) {
          const next = new Set(s.additionalSelectedIds);
          const promoted = next.values().next().value as string | undefined;
          if (promoted !== undefined) next.delete(promoted);
          return { selectedObjectId: promoted ?? null, additionalSelectedIds: next };
        }
        const next = new Set(s.additionalSelectedIds);
        if (next.has(id)) {
          next.delete(id);
          return { additionalSelectedIds: next };
        }
        // If nothing is selected yet, the toggle becomes the primary.
        if (s.selectedObjectId === null) {
          return { selectedObjectId: id, additionalSelectedIds: next };
        }
        next.add(id);
        return { additionalSelectedIds: next };
      }),
    selectAllObjects: () =>
      set((s) => {
        const ids = s.project.scene.objects.map((o) => o.id);
        const [primary, ...rest] = ids;
        return {
          selectedObjectId: primary ?? null,
          additionalSelectedIds: new Set(rest),
        };
      }),
    togglePreview: () => set((s) => ({ previewMode: !s.previewMode })),
    setCursorMm: (cursor) => set({ cursorMm: cursor }),
  };
}

function applyTransformToScene(project: Project, id: string, transform: Transform): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((o) => (o.id === id ? { ...o, transform } : o)),
    },
  };
}

function interactionActions(
  set: Setter,
): Pick<
  AppState,
  'beginInteraction' | 'setObjectTransform' | 'endInteraction' | 'applyObjectTransform'
> {
  return {
    beginInteraction: () => set((s) => ({ pendingUndo: s.project })),
    setObjectTransform: (id, transform) =>
      set((s) => ({ project: applyTransformToScene(s.project, id, transform), dirty: true })),
    endInteraction: () =>
      set((s) => {
        if (s.pendingUndo === null) return s;
        if (s.pendingUndo === s.project) return { pendingUndo: null };
        return {
          pendingUndo: null,
          undoStack: pushUndo(s.pendingUndo, s.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
    applyObjectTransform: (id, transform) =>
      set((s) => ({
        project: applyTransformToScene(s.project, id, transform),
        undoStack: pushUndo(s.project, s.undoStack),
        redoStack: [],
        dirty: true,
      })),
  };
}

function saveTrackingActions(set: Setter): Pick<AppState, 'markSaved' | 'markLoaded'> {
  return {
    markSaved: (target) =>
      set({ dirty: false, savedName: target.displayName, lastSaveTarget: target }),
    // Opening a file: clear dirty, remember the name for the title bar, but
    // drop any save target — the next Ctrl+S re-prompts (we'd need to keep
    // the FileSystemFileHandle / Electron path to write through without a
    // dialog, which is Phase C autosave-territory).
    markLoaded: (filename) =>
      set({ dirty: false, savedName: filename, lastSaveTarget: null }),
  };
}

export const useStore = create<AppState>((set, get) => ({
  ...initialState(),
  ...projectActions(set),
  ...importSvgObjectAction(set, get),
  ...sceneActions(set),
  ...historyActions(set),
  ...viewActions(set),
  ...interactionActions(set),
  ...saveTrackingActions(set),
}));
