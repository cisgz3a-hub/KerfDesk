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
  artworkOperationName,
  createArtworkOperation,
  createArtworkOperations,
  createLayer,
  fitObjectToBed,
  type ImportedSvg,
  type Project,
  type RasterImage,
  removeObject,
  replaceObject,
  type Scene,
  type SceneObject,
  sceneObjectUsesOperation,
  type TextObject,
  type TracedImage,
} from '../../core/scene';
import { applyCncTextDefaultsToNewLayer } from './cnc-text-defaults';
import { duplicateArtworkWithOperations } from './duplicate-artwork';
import { positionTraceOverRasterSource } from './trace-placement';

export { positionTraceOverRasterSource } from './trace-placement';

// Shared undo/redo stack ceiling. store-actions caps the redo stack against the
// same value, so it lives here (the module both stacks depend on) rather than
// being redeclared — keeping the two ceilings from silently desyncing.
export const HISTORY_DEPTH = 50;
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
export type StateSlice = {
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

export type TraceExistingImageOptions = {
  readonly deleteSourceAfterTrace?: boolean;
  readonly replaceTraceId?: string;
};

type PreparedTraceSource = {
  readonly scene: Scene;
  readonly source?: RasterImage;
  readonly shouldPruneLayers: boolean;
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

// F.2.c: dedicated layer-ensurer for raster images. The new layer comes up in mode='image'
// instead of the default 'line'. If a layer with that color already
// exists, it's untouched — we don't auto-flip an existing layer's
// mode (would surprise the user; they may have other line/fill work
// on that color).
export function ensureRasterImageLayer(scene: Scene, color: string, linesPerMm?: number): Scene {
  const exists = scene.layers.some((l) => l.color === color);
  if (exists) return scene;
  const layer = createLayer({ id: color, color, mode: 'image' });
  return addLayer(scene, linesPerMm === undefined ? layer : { ...layer, linesPerMm });
}

// A raster engraves only on an image-mode layer (compile-job's image arm). If
// the preferred color already exists as a LINE/FILL layer — e.g. the user has
// gray vector work on #808080 — reusing it would strand the raster on a layer
// that won't engrave it (P2-A; preflight catches it as layer-mode-mismatch, but
// better not to collide in the first place). Reuse the color only when it is
// free or already an image layer; otherwise pick the first unused variant so
// the raster gets its own image layer.
export function resolveRasterLayerColor(
  scene: Scene,
  preferred: string,
  linesPerMm?: number,
): string {
  const existing = scene.layers.find((l) => l.color === preferred);
  if (existing === undefined) return preferred;
  if (
    existing.mode === 'image' &&
    (linesPerMm === undefined || existing.linesPerMm === linesPerMm)
  ) {
    return preferred;
  }
  const used = new Set(scene.layers.map((l) => l.color));
  const base = Number.parseInt(preferred.replace('#', ''), 16);
  const start = Number.isNaN(base) ? 0x808080 : base;
  for (let n = 1; n <= 0xffffff; n += 1) {
    const candidate = `#${(((start + n) & 0xffffff) >>> 0).toString(16).padStart(6, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  return preferred; // 16M layers in use — pathological; preflight will catch it
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
  let scene = s.project.scene;
  const newIds: string[] = [];
  for (const oldId of ids) {
    const original = scene.objects.find((o) => o.id === oldId);
    if (original === undefined) continue;
    // Duplicate places the clone exactly over the source (LightBurn parity); the
    // operator then moves it. Fresh imports (applyFreshImport) and paste keep
    // their own stagger — only Duplicate is in place.
    const duplicated = duplicateArtworkWithOperations(scene, original, newIdFor(oldId));
    scene = duplicated.scene;
    newIds.push(duplicated.object.id);
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
// stay polluted with stale per-color settings. Two consumer shapes:
// objects with `paths` (imported-svg, text, traced-image, shape) contribute
// one used-color per path; raster-image contributes its single `color` field
// (F.2.c). Match the same kinds compileJob walks.
export function pruneOrphanLayers(scene: Scene): Scene {
  const kept = scene.layers.filter((operation) =>
    scene.objects.some((object) => sceneObjectUsesOperation(object, operation)),
  );
  if (kept.length === scene.layers.length) return scene;
  return { ...scene, layers: kept };
}

export function applyFreshImport(
  s: StateSlice,
  object: SceneObject,
  batchOffsetIdx: number,
): MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> } {
  // Auto-fit + center on the bed so a 1000 mm SVG dropped on a 400 mm
  // bed doesn't disappear off the corner. Small designs stay at scale 1.
  const fitted = fitObjectToBed(object, s.project.device.bedWidth, s.project.device.bedHeight);
  // Multi-import stagger (F-A3): shift Nth file by 10 mm × N right+down.
  const offset = batchOffsetIdx * MULTI_IMPORT_OFFSET_MM;
  let positioned: SceneObject =
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
  // Re-colour an imported raster onto a free/own image layer if its preferred
  // color collides with an existing non-image layer (P2-A).
  if (positioned.kind === 'raster-image') {
    const color = resolveRasterLayerColor(s.project.scene, positioned.color);
    if (color !== positioned.color) positioned = { ...positioned, color };
  }
  const created = createArtworkOperations(s.project.scene, positioned, {
    mode: freshArtworkMode(positioned),
  });
  positioned = created.object;
  let scene = addObject(s.project.scene, positioned);
  for (const operation of created.operations) scene = addLayer(scene, operation);
  return {
    project: { ...s.project, scene },
    selectedObjectId: positioned.id,
    // A fresh import is the sole selection (F-A3): clear any prior
    // multi-selection so Delete/duplicate cannot act on a stale ghost set.
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function freshArtworkMode(object: SceneObject): 'line' | 'fill' | 'image' {
  if (object.kind === 'raster-image') return 'image';
  if (object.kind === 'traced-image') {
    if (object.traceMode === 'centerline' || object.traceMode === 'edge') return 'line';
    return object.operationOverride?.mode ?? 'fill';
  }
  return object.operationOverride?.mode ?? 'line';
}

// Trace paths use the actual capped working grid reported by the tracer, while
// the imported burn bitmap can retain a larger pixel grid. The shared placement
// helper maps that trace grid across the bitmap's complete local-mm bounds and
// then composes its scale, mirror, rotation, and translation. This keeps both
// full-image and region traces registered even when bounds are non-zero or the
// burn and trace decode sizes differ.
// ADR-026 (unified image flow): a trace overlays the bitmap it was
// traced FROM — which the operator imported first as a standalone raster
// (LightBurn's model: Trace is a tool run on a SELECTED image, not a
// second import). We find that existing bitmap by id and give the trace a
// transform that maps its pixel-space points onto the bitmap's mm extent
// (positionTraceOverRasterSource) so the vectors land pixel-for-pixel over the
// features they came from, then tag the bitmap 'trace-source' so the
// canvas tints it as the deletable backing. The trace is appended last
// (drawn on top) and becomes the selection, so "delete the source to
// keep the trace" stays the obvious next gesture; a single pushUndo
// covers the change.
//
// Total + defensive: if `sourceId` no longer resolves to a raster
// (shouldn't happen — the dialog seeds from a live selection behind a
// modal), the trace is still added at its own transform rather than
// silently lost.
export function applyTraceToExisting(
  s: StateSlice,
  sourceId: string,
  traced: TracedImage,
  options: TraceExistingImageOptions = {},
): MutationResult {
  const existing = s.project.scene.objects.find((o) => o.id === sourceId);
  const prepared = prepareTraceSource(s.project.scene, existing, options);
  let scene = prepared.scene;
  const positionedTrace =
    prepared.source === undefined ? traced : positionTraceOverRasterSource(prepared.source, traced);
  if (options.replaceTraceId !== undefined && options.replaceTraceId !== positionedTrace.id) {
    scene = removeObject(scene, options.replaceTraceId);
  }
  const replaceInPlace =
    options.replaceTraceId === positionedTrace.id &&
    scene.objects.some((object) => object.id === positionedTrace.id);
  const created = createArtworkOperations(scene, positionedTrace, {
    mode: freshArtworkMode(positionedTrace),
  });
  scene = replaceInPlace
    ? replaceObject(scene, positionedTrace.id, created.object)
    : addObject(scene, created.object);
  for (const operation of created.operations) scene = addLayer(scene, operation);
  if (prepared.shouldPruneLayers || options.replaceTraceId !== undefined) {
    scene = pruneOrphanLayers(scene);
  }
  return {
    project: { ...s.project, scene },
    selectedObjectId: positionedTrace.id,
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function prepareTraceSource(
  scene: Scene,
  existing: SceneObject | undefined,
  options: TraceExistingImageOptions,
): PreparedTraceSource {
  if (existing === undefined || existing.kind !== 'raster-image') {
    return { scene, shouldPruneLayers: false };
  }
  if (options.deleteSourceAfterTrace === true) {
    return {
      scene: removeObject(scene, existing.id),
      source: existing,
      shouldPruneLayers: true,
    };
  }
  const taggedSource: RasterImage = { ...existing, role: 'trace-source' };
  return {
    scene: replaceObject(scene, existing.id, taggedSource),
    source: existing,
    shouldPruneLayers: false,
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
  const { operationIds: _incomingOperationIds, ...incomingWithoutOperationIds } = incoming;
  const inheritedPaths = inheritPathOperationIds(existing, incoming);
  const replaced: ImportedSvg = {
    ...incomingWithoutOperationIds,
    id: existing.id,
    transform: existing.transform,
    paths: inheritedPaths,
  };
  const prepared = addMissingReimportOperations(s.project.scene, replaced);
  let scene = replaceObject(prepared.scene, existing.id, prepared.object);
  scene = pruneOrphanLayers(scene);
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

function inheritPathOperationIds(
  existing: ImportedSvg,
  incoming: ImportedSvg,
): ImportedSvg['paths'] {
  return incoming.paths.map((path) => {
    const previous = existing.paths.find((candidate) => candidate.color === path.color);
    const ids =
      previous?.operationIds ?? (previous === undefined ? undefined : existing.operationIds);
    return ids === undefined ? path : { ...path, operationIds: ids };
  });
}

function addMissingReimportOperations(
  scene: Scene,
  object: ImportedSvg,
): { readonly scene: Scene; readonly object: ImportedSvg } {
  const missingColors = [
    ...new Set(
      object.paths
        .filter((path) => (path.operationIds?.length ?? 0) === 0)
        .map((path) => path.color.toLowerCase()),
    ),
  ];
  if (missingColors.length === 0) return { scene, object };
  let workingScene = scene;
  let paths = object.paths;
  const assignedCount = new Set(paths.flatMap((path) => path.operationIds ?? [])).size;
  missingColors.forEach((color, index) => {
    const created = createArtworkOperation(workingScene, object, {
      name: `${artworkOperationName(object)} ${assignedCount + index + 1}`,
    });
    workingScene = addLayer(workingScene, created.operation);
    paths = paths.map((path) =>
      path.color.toLowerCase() === color && (path.operationIds?.length ?? 0) === 0
        ? { ...path, operationIds: [created.operation.id] }
        : path,
    );
  });
  return { scene: workingScene, object: { ...object, paths } };
}

// Insert or update a TextObject by id. On edit (id matches), keeps
// the existing object's transform so the user's position survives
// re-renders. On add, fits to the bed like a fresh SVG import.
export function applyUpsertText(s: StateSlice, text: TextObject): MutationResult {
  const existing = s.project.scene.objects.find((o) => o.id === text.id);
  let scene: Scene;
  let operationId: string | null = null;
  if (existing !== undefined) {
    const preserved: TextObject = {
      ...text,
      transform: text.pathText === undefined ? existing.transform : text.transform,
      ...(existing.operationIds === undefined ? {} : { operationIds: existing.operationIds }),
      paths: text.paths.map((path, index) => {
        const operationIds = 'paths' in existing ? existing.paths[index]?.operationIds : undefined;
        return operationIds === undefined ? path : { ...path, operationIds };
      }),
    };
    scene = replaceObject(s.project.scene, text.id, preserved);
  } else {
    const created = createArtworkOperation(s.project.scene, text);
    const prepared =
      text.pathText !== undefined
        ? created.object
        : fitObjectToBed(created.object, s.project.device.bedWidth, s.project.device.bedHeight);
    scene = addLayer(addObject(s.project.scene, prepared), created.operation);
    operationId = created.operation.id;
  }
  // H.6c: a text layer born in CNC mode gets text-appropriate CNC settings
  // (v-carve with a v-bit, on-path engrave otherwise) instead of the
  // letter-destroying profile-outside default.
  if (operationId !== null) {
    scene = applyCncTextDefaultsToNewLayer(scene, s.project.machine, operationId, text.fontKey);
  }
  return {
    project: { ...s.project, scene },
    selectedObjectId: text.id,
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}
