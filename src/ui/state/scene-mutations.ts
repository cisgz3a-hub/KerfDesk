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
  type RasterImage,
  removeObject,
  replaceObject,
  type Scene,
  type SceneObject,
  type TextObject,
  type TracedImage,
  type Transform,
  updateLayer,
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

function ensureFillLayersForColors(
  scene: Scene,
  paths: ReadonlyArray<{ readonly color: string }>,
): Scene {
  return ensureLayersForMode(scene, paths, 'fill');
}

function ensureLineLayersForColors(
  scene: Scene,
  paths: ReadonlyArray<{ readonly color: string }>,
): Scene {
  return ensureLayersForMode(scene, paths, 'line');
}

function ensureLayersForMode(
  scene: Scene,
  paths: ReadonlyArray<{ readonly color: string }>,
  mode: 'fill' | 'line',
): Scene {
  let out = scene;
  for (const path of paths) {
    const existing = out.layers.find((l) => l.color === path.color);
    if (existing === undefined) {
      out = addLayer(out, createLayer({ id: path.color, color: path.color, mode }));
    } else if (existing.mode !== mode) {
      out = updateLayer(out, existing.id, { mode });
    }
  }
  return out;
}

// F.2.c: dedicated layer-ensurer for raster images. Same shape as
// ensureLayersForColors but the new layer comes up in mode='image'
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
// stay polluted with stale per-color settings. Two consumer shapes:
// objects with `paths` (imported-svg, text, traced-image) contribute
// one used-color per path; raster-image contributes its single
// `color` field (F.2.c). Match the same kinds compileJob walks.
export function pruneOrphanLayers(scene: Scene): Scene {
  const usedColors = new Set<string>();
  for (const obj of scene.objects) {
    if (obj.kind === 'imported-svg' || obj.kind === 'text' || obj.kind === 'traced-image') {
      for (const p of obj.paths) usedColors.add(p.color);
    } else if (obj.kind === 'raster-image') {
      usedColors.add(obj.color);
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
  let scene = addObject(s.project.scene, positioned);
  if (
    positioned.kind === 'imported-svg' ||
    positioned.kind === 'text' ||
    positioned.kind === 'traced-image'
  ) {
    scene = ensureLayersForColors(scene, positioned.paths);
  } else if (positioned.kind === 'raster-image') {
    // F.2.c: ensure an image-mode layer exists for the raster's
    // color. Raster images bring their own color (typically the
    // canonical DEFAULT_RASTER_LAYER_COLOR) and need mode='image'
    // on the created layer so the eventual F.2.d compile arm
    // dispatches to emit-raster.
    scene = ensureRasterImageLayer(scene, positioned.color);
  }
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

// Build the transform that lands a trace pixel-for-pixel over the bitmap
// it was traced from. imagetracerjs emits polylines in the source's PIXEL
// space (1 unit = 1 px), but the bitmap was imported in millimetres — its
// object-local `bounds` span the mm size (import-DPI sizing — density
// metadata when present, else the ADR-048 default; ADR-027) while
// `pixelWidth/Height` record the original px grid. Both objects are
// drawn through the SAME applyTransform (scale→mirror→rotate→translate),
// so reusing the bitmap's raw transform would leave pixel-unit vectors
// (extent = pixelWidth) over an mm-unit bitmap (extent = widthMm) — off by
// the bitmap's own widthMm/pixelWidth (mm-per-pixel) ratio, so the trace
// renders far too large. Folding the bitmap's mm-per-pixel into the trace's
// scale converts
// the pixel points into the same mm frame. Rotation, mirror, and the
// translate are inherited unchanged; this is exact because imported rasters
// always have bounds anchored at (0,0) (so there is no bounds offset for
// the scale to interact with). Degenerate 0-px sources fall back to the
// raw transform — a 0-px image traces to nothing anyway.
function overlayTransformForRaster(source: RasterImage): Transform {
  if (source.pixelWidth === 0 || source.pixelHeight === 0) return source.transform;
  const mmPerPxX = (source.bounds.maxX - source.bounds.minX) / source.pixelWidth;
  const mmPerPxY = (source.bounds.maxY - source.bounds.minY) / source.pixelHeight;
  return {
    ...source.transform,
    scaleX: source.transform.scaleX * mmPerPxX,
    scaleY: source.transform.scaleY * mmPerPxY,
  };
}

// ADR-026 (unified image flow): a trace overlays the bitmap it was
// traced FROM — which the operator imported first as a standalone raster
// (LightBurn's model: Trace is a tool run on a SELECTED image, not a
// second import). We find that existing bitmap by id and give the trace a
// transform that maps its pixel-space points onto the bitmap's mm extent
// (overlayTransformForRaster) so the vectors land pixel-for-pixel over the
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
  let scene = s.project.scene;
  let transform = traced.transform;
  if (existing !== undefined && existing.kind === 'raster-image') {
    transform = overlayTransformForRaster(existing);
    if (options.deleteSourceAfterTrace === true) {
      scene = removeObject(scene, existing.id);
    } else {
      const taggedSource: RasterImage = { ...existing, role: 'trace-source' };
      scene = replaceObject(scene, existing.id, taggedSource);
    }
  }
  const positionedTrace: TracedImage = { ...traced, transform };
  scene = addObject(scene, positionedTrace);
  scene =
    positionedTrace.traceMode === 'centerline'
      ? ensureLineLayersForColors(scene, positionedTrace.paths)
      : ensureFillLayersForColors(scene, positionedTrace.paths);
  if (existing !== undefined && options.deleteSourceAfterTrace === true) {
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
