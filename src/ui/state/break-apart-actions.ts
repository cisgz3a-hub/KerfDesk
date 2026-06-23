import type { Bounds, ColoredPath, ImportedSvg, Project, SceneObject } from '../../core/scene';
import { pushUndo, type StateSlice } from './scene-mutations';
import { selectedObjectIds } from './scene-group-actions';

export type BreakApartActions = {
  readonly breakApartSelection: () => void;
};

type BreakApartState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type BreakApartMutation = {
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type BreakApartSet = (fn: (state: BreakApartState) => BreakApartMutation | BreakApartState) => void;

export function breakApartActions(set: BreakApartSet): BreakApartActions {
  return {
    breakApartSelection: () => set((state) => breakApartSelectionMutation(state)),
  };
}

function breakApartSelectionMutation(state: BreakApartState): BreakApartMutation | BreakApartState {
  const selectedIds = selectedObjectIds(state);
  if (selectedIds.length === 0) return state;
  const selected = new Set(selectedIds);
  const replacement = buildReplacementObjects(state.project.scene.objects, selected);
  if (!replacement.changed) return state;
  const [primary, ...additional] = replacement.newSelectionIds;
  return {
    project: {
      ...state.project,
      scene: { ...state.project.scene, objects: replacement.objects },
    },
    selectedObjectId: primary ?? null,
    additionalSelectedIds: new Set(additional),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function buildReplacementObjects(
  objects: ReadonlyArray<SceneObject>,
  selectedIds: ReadonlySet<string>,
): {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly newSelectionIds: ReadonlyArray<string>;
  readonly changed: boolean;
} {
  const out: SceneObject[] = [];
  const newSelectionIds: string[] = [];
  let changed = false;
  for (const object of objects) {
    if (selectedIds.has(object.id) && canBreakApart(object)) {
      const parts = splitImportedSvg(
        object,
        new Set([...objects.map((item) => item.id), ...newSelectionIds]),
      );
      out.push(...parts);
      newSelectionIds.push(...parts.map((part) => part.id));
      changed = true;
    } else {
      out.push(object);
      if (selectedIds.has(object.id)) newSelectionIds.push(object.id);
    }
  }
  return { objects: out, newSelectionIds, changed };
}

function canBreakApart(object: SceneObject): object is ImportedSvg {
  return object.kind === 'imported-svg' && splitUnitCount(object) > 1 && object.locked !== true;
}

function splitImportedSvg(
  object: ImportedSvg,
  reservedIds: ReadonlySet<string>,
): ReadonlyArray<ImportedSvg> {
  const parts: ImportedSvg[] = [];
  for (const [index, path] of splitPaths(object.paths).entries()) {
    const id = uniquePartId(
      object.id,
      index,
      new Set([...reservedIds, ...parts.map((part) => part.id)]),
    );
    parts.push({
      ...object,
      id,
      source: `${object.source}#part-${index + 1}`,
      bounds: boundsForPath(path) ?? object.bounds,
      paths: [path],
    });
  }
  return parts;
}

function splitPaths(paths: ReadonlyArray<ColoredPath>): ReadonlyArray<ColoredPath> {
  return paths.flatMap((path) =>
    path.polylines.map((polyline) => ({
      color: path.color,
      polylines: [polyline],
    })),
  );
}

function splitUnitCount(object: ImportedSvg): number {
  return object.paths.reduce((count, path) => count + path.polylines.length, 0);
}

function uniquePartId(sourceId: string, index: number, reservedIds: ReadonlySet<string>): string {
  const base = `${sourceId}__part_${index + 1}`;
  if (!reservedIds.has(base)) return base;
  for (let suffix = 2; suffix <= MAX_ID_SUFFIX; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!reservedIds.has(candidate)) return candidate;
  }
  return `${base}_${crypto.randomUUID()}`;
}

function boundsForPath(path: ColoredPath): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polyline of path.polylines) {
    for (const point of polyline.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

const MAX_ID_SUFFIX = 1000;
