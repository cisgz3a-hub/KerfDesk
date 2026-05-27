// scene-mutations — the importSvgObject / upsertTextObject helpers
// extracted from store.ts so the latter stays under the 400-line
// hard cap. Pure-ish: each function takes the current AppState and
// the incoming object, returns a Partial<AppState> the store applies.
//
// The two import paths (fresh add vs. re-import-with-source-match)
// + the layer-ensure helper live here; store.ts dispatches.

import {
  addLayer,
  addObject,
  createLayer,
  fitObjectToBed,
  type ImportedSvg,
  type Project,
  replaceObject,
  type Scene,
  type SceneObject,
  type TextObject,
} from '../../core/scene';

const HISTORY_DEPTH = 50;
const MULTI_IMPORT_OFFSET_MM = 10;

export type ImportOutcome =
  | { readonly kind: 'added' }
  | {
      readonly kind: 'replaced';
      readonly source: string;
      readonly kept: number;
      readonly added: number;
      readonly removed: number;
    };

// Minimal slice of AppState these helpers need. Avoids a circular
// store.ts <-> scene-mutations.ts import (store imports AppState
// from itself, so we'd loop). Restating just the fields used.
type StateSlice = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
};

export type MutationResult = {
  readonly project: Project;
  readonly selectedObjectId: string;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

// Push the previous project onto undoStack with a depth cap. Co-located
// with the mutation helpers since every action that calls them needs
// the same shape.
export function pushUndo(prev: Project, stack: ReadonlyArray<Project>): ReadonlyArray<Project> {
  return [...stack, prev].slice(-HISTORY_DEPTH);
}

// Find an existing imported-SVG whose source filename matches the
// incoming one. Used to decide between fresh-add and replace-in-place
// semantics (Phase C re-import).
export function findReimportTarget(scene: Scene, object: SceneObject): ImportedSvg | null {
  if (object.kind !== 'imported-svg') return null;
  for (const existing of scene.objects) {
    if (existing.kind === 'imported-svg' && existing.source === object.source) {
      return existing;
    }
  }
  return null;
}

export function ensureLayersForColors(
  scene: Scene,
  paths: ReadonlyArray<{ readonly color: string }>,
): Scene {
  let out = scene;
  for (const path of paths) {
    const exists = out.layers.some((l) => l.color === path.color);
    if (!exists) {
      out = addLayer(out, createLayer({ id: path.color, color: path.color }));
    }
  }
  return out;
}

// Clone every selected SceneObject with a fresh id and a 10 mm offset.
// Returns the new selection (first clone as primary, rest as extras)
// plus the new scene + undo push. Matches the F-A3 multi-import
// stagger so duplicate-of-multi feels consistent.
//
// Empty selection → no-op; the caller's `set((s) => ...)` should fall
// through without changing state (the undefined return signals that).
export function applyDuplicate(
  s: StateSlice & {
    readonly selectedObjectId: string | null;
    readonly additionalSelectedIds: ReadonlySet<string>;
  },
  newIdFor: (oldId: string) => string,
): (MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> }) | null {
  const ids: string[] = [
    ...(s.selectedObjectId !== null ? [s.selectedObjectId] : []),
    ...s.additionalSelectedIds,
  ];
  if (ids.length === 0) return null;
  const offset = MULTI_IMPORT_OFFSET_MM;
  let scene = s.project.scene;
  const newIds: string[] = [];
  for (const oldId of ids) {
    const original = scene.objects.find((o) => o.id === oldId);
    if (original === undefined) continue;
    const clone = {
      ...original,
      id: newIdFor(oldId),
      transform: {
        ...original.transform,
        x: original.transform.x + offset,
        y: original.transform.y + offset,
      },
    } as SceneObject;
    scene = addObject(scene, clone);
    newIds.push(clone.id);
  }
  if (newIds.length === 0) return null;
  const [first, ...rest] = newIds;
  return {
    project: { ...s.project, scene },
    selectedObjectId: first ?? '',
    additionalSelectedIds: new Set(rest),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// Drop layers whose color isn't referenced by any remaining object.
// Called after removeSceneObject so the Cuts/Layers panel doesn't
// stay polluted with stale per-color settings. Only object kinds
// that own `paths` count as consumers (imported-svg, text,
// traced-image). Match the same kinds compileJob walks.
export function pruneOrphanLayers(scene: Scene): Scene {
  const usedColors = new Set<string>();
  for (const obj of scene.objects) {
    if (obj.kind === 'imported-svg' || obj.kind === 'text' || obj.kind === 'traced-image') {
      for (const p of obj.paths) usedColors.add(p.color);
    }
  }
  const kept = scene.layers.filter((l) => usedColors.has(l.color));
  if (kept.length === scene.layers.length) return scene;
  return { ...scene, layers: kept };
}

export function applyFreshImport(
  s: StateSlice,
  object: SceneObject,
  batchOffsetIdx: number,
): MutationResult {
  // Auto-fit + center on the bed so a 1000 mm SVG dropped on a 400 mm
  // bed doesn't disappear off the corner. Small designs stay at scale 1.
  const fitted = fitObjectToBed(object, s.project.device.bedWidth, s.project.device.bedHeight);
  // Multi-import stagger (F-A3): shift Nth file by 10 mm × N right+down.
  const offset = batchOffsetIdx * MULTI_IMPORT_OFFSET_MM;
  const positioned =
    offset === 0
      ? fitted
      : {
          ...fitted,
          transform: {
            ...fitted.transform,
            x: fitted.transform.x + offset,
            y: fitted.transform.y + offset,
          },
        };
  let scene = addObject(s.project.scene, positioned);
  if (
    positioned.kind === 'imported-svg' ||
    positioned.kind === 'text' ||
    positioned.kind === 'traced-image'
  ) {
    scene = ensureLayersForColors(scene, positioned.paths);
  }
  return {
    project: { ...s.project, scene },
    selectedObjectId: positioned.id,
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

export function applyReimport(
  s: StateSlice,
  existing: ImportedSvg,
  incoming: ImportedSvg,
): { readonly state: MutationResult; readonly outcome: ImportOutcome } {
  // Swap content + bounds but keep id and transform so the user's
  // chosen position/scale/rotation survives. Layer settings carry
  // over for any color still present (layers are keyed by color,
  // scene-wide).
  const replaced: ImportedSvg = { ...incoming, id: existing.id, transform: existing.transform };
  let scene = replaceObject(s.project.scene, existing.id, replaced);
  scene = ensureLayersForColors(scene, replaced.paths);
  const oldColors = new Set(existing.paths.map((p) => p.color));
  const newColors = new Set(replaced.paths.map((p) => p.color));
  let kept = 0;
  let added = 0;
  let removed = 0;
  for (const c of newColors) {
    if (oldColors.has(c)) kept += 1;
    else added += 1;
  }
  for (const c of oldColors) {
    if (!newColors.has(c)) removed += 1;
  }
  return {
    state: {
      project: { ...s.project, scene },
      selectedObjectId: existing.id,
      undoStack: pushUndo(s.project, s.undoStack),
      redoStack: [],
      dirty: true,
    },
    outcome: { kind: 'replaced', source: replaced.source, kept, added, removed },
  };
}

// Insert or update a TextObject by id. On edit (id matches), keeps
// the existing object's transform so the user's position survives
// re-renders. On add, fits to the bed like a fresh SVG import.
export function applyUpsertText(s: StateSlice, text: TextObject): MutationResult {
  const existing = s.project.scene.objects.find((o) => o.id === text.id);
  let scene: Scene;
  if (existing !== undefined) {
    const preserved: TextObject = { ...text, transform: existing.transform };
    scene = replaceObject(s.project.scene, text.id, preserved);
  } else {
    const fitted = fitObjectToBed(text, s.project.device.bedWidth, s.project.device.bedHeight);
    scene = addObject(s.project.scene, fitted);
  }
  scene = ensureLayersForColors(scene, text.paths);
  return {
    project: { ...s.project, scene },
    selectedObjectId: text.id,
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}
