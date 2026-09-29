// Delete Duplicates, Close Path and Reverse Direction (LightBurn gap batch 5,
// LBG-F08, ADR-480). Each is one undo step and says what it did. Close and
// Reverse edit paths the node tools can edit (imported and traced artwork and
// drawn polylines); text and drawn rectangles, ellipses and polygons rebuild
// their paths from their settings, so they are left as they are.

import { boundsForPaths } from '../../core/geometry/vector-path-tools';
import { duplicateObjectIds } from '../../core/geometry/duplicate-shapes';
import {
  closeOpenPaths,
  isCloseablePolyline,
  reversePaths,
} from '../../core/geometry/path-direction-edits';
import type { CncTabAnchor, ColoredPath, Scene, SceneObject } from '../../core/scene';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import { removeSceneObjectsFromState } from './object-delete-actions';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type PathCleanupActions = {
  /** Delete later copies of artwork drawn twice in the same place on the same operation. */
  readonly deleteDuplicates: () => void;
  /** Close the open paths of the selected artwork. */
  readonly closeSelectedPaths: () => void;
  /** Reverse the drawing direction of the selected artwork's paths. */
  readonly reverseSelectedPaths: () => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
type PathEdit = { readonly paths: ReadonlyArray<ColoredPath>; readonly count: number };
type EditKind = 'close' | 'reverse';

export function pathCleanupActions(set: Setter): PathCleanupActions {
  return {
    deleteDuplicates: () => set(deleteDuplicatesMutation),
    closeSelectedPaths: () =>
      set((state) => {
        let longestGapMm = 0;
        const edit = editSelectedPaths(state, 'close', (object) => {
          const result = closeOpenPaths(object.paths, object.transform);
          longestGapMm = Math.max(longestGapMm, result.longestGapMm);
          return { paths: result.paths, count: result.closed };
        });
        toast(closeMessage(edit.count, longestGapMm, skippedOpenObjects(state)));
        return edit.state;
      }),
    reverseSelectedPaths: () =>
      set((state) => {
        let openReversed = 0;
        const edit = editSelectedPaths(state, 'reverse', (object) => {
          const result = reversePaths(object.paths);
          openReversed += result.openReversed;
          return { paths: result.paths, count: result.reversed };
        });
        toast(reverseMessage(edit.count, openReversed > 0 && openPathsMayFlip(state)));
        return edit.state;
      }),
  };
}

function deleteDuplicatesMutation(state: AppState): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const ids = duplicateObjectIds(scene.objects, scene.layers, protectedObjectIds(scene));
  if (ids.length === 0) {
    toast('No duplicates: nothing is drawn twice in the same place on the same operation.');
    return state;
  }
  toast(`Deleted ${ids.length === 1 ? '1 duplicate object' : `${ids.length} duplicate objects`}.`);
  return removeSceneObjectsFromState(state, ids);
}

// Never delete what the user locked, or what another object depends on.
function protectedObjectIds(scene: Scene): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const object of scene.objects) {
    if (object.locked === true) ids.add(object.id);
    if (object.kind === 'raster-image' && object.imageMaskId !== undefined) {
      ids.add(object.imageMaskId);
    }
    if (object.kind === 'text' && object.pathText !== undefined) {
      ids.add(object.pathText.guideObjectId);
    }
  }
  return ids;
}

type EditableObject = Extract<
  SceneObject,
  { readonly kind: 'imported-svg' | 'traced-image' | 'shape' }
>;

function isPathEditable(object: SceneObject): object is EditableObject {
  return (
    object.kind === 'imported-svg' ||
    object.kind === 'traced-image' ||
    (object.kind === 'shape' && object.spec.kind === 'polyline')
  );
}

function editableSelection(state: AppState): ReadonlyArray<EditableObject> {
  const ids = new Set(selectedObjectIds(state));
  return state.project.scene.objects.filter(
    (object): object is EditableObject =>
      ids.has(object.id) && object.locked !== true && isPathEditable(object),
  );
}

function editSelectedPaths(
  state: AppState,
  kind: EditKind,
  edit: (object: EditableObject) => PathEdit,
): { readonly state: AppState | Partial<AppState>; readonly count: number } {
  const targets = new Set(editableSelection(state).map((object) => object.id));
  let count = 0;
  const objects = state.project.scene.objects.map((object) => {
    if (!targets.has(object.id) || !isPathEditable(object)) return object;
    const result = edit(object);
    if (result.count === 0) return object;
    const updated = withPaths(object, result.paths, kind === 'reverse');
    if (updated === null) return object;
    count += result.count;
    return updated;
  });
  if (count === 0) return { state, count };
  return {
    count,
    state: {
      project: { ...state.project, scene: { ...state.project.scene, objects } },
      undoStack: pushUndo(state.project, state.undoStack),
      redoStack: [],
      dirty: true,
      selectedPathNode: null,
      selectedPathNodes: [],
    },
  };
}

function withPaths(
  object: EditableObject,
  paths: ReadonlyArray<ColoredPath>,
  reversed: boolean,
): SceneObject | null {
  const bounds = boundsForPaths(paths) ?? object.bounds;
  const anchors = reversed ? reversedTabAnchors(object, paths) : {};
  if (object.kind === 'shape') {
    const synced = synchronizePolylineShapeGeometry(object, paths, bounds);
    return synced === null ? null : { ...synced, ...anchors };
  }
  return { ...object, paths, bounds, ...anchors };
}

// Tabs placed by hand, CNC and laser (ADR-494 Amendment 1), follow each
// reversed contour; anchors on contours left unchanged keep their fraction.
function reversedTabAnchors(
  object: EditableObject,
  paths: ReadonlyArray<ColoredPath>,
): Pick<SceneObject, 'cncTabAnchors' | 'laserTabAnchors'> {
  const follow = <A extends CncTabAnchor>(anchors: ReadonlyArray<A>): ReadonlyArray<A> =>
    anchors.map((anchor) => {
      const before = object.paths[anchor.pathIndex]?.polylines[anchor.polylineIndex];
      const after = paths[anchor.pathIndex]?.polylines[anchor.polylineIndex];
      return before !== undefined && after !== undefined && before !== after
        ? reverseAnchor(anchor)
        : anchor;
    });
  return {
    ...(object.cncTabAnchors === undefined ? {} : { cncTabAnchors: follow(object.cncTabAnchors) }),
    ...(object.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: follow(object.laserTabAnchors) }),
  };
}

// A placed tab sits at a fraction of its contour's length from the start.
// Reversing a contour (a closed one keeps its start) moves t to 1 - t.
function reverseAnchor<A extends CncTabAnchor>(anchor: A): A {
  return { ...anchor, pathT: anchor.pathT === 0 ? 0 : 1 - anchor.pathT };
}

function skippedOpenObjects(state: AppState): number {
  const ids = new Set(selectedObjectIds(state));
  return state.project.scene.objects.filter(
    (object) =>
      ids.has(object.id) &&
      !isPathEditable(object) &&
      'paths' in object &&
      object.paths.some((path) => path.polylines.some(isCloseablePolyline)),
  ).length;
}

function openPathsMayFlip(state: AppState): boolean {
  const optimization = state.project.optimization;
  return (
    optimization.pathDirection === 'allow-reverse' && optimization.travelPolicy !== 'source-order'
  );
}

function closeMessage(closed: number, longestGapMm: number, skipped: number): string {
  const skippedNote =
    skipped === 0
      ? ''
      : ' Text and drawn shapes keep their own paths; convert them to paths first.';
  if (closed === 0) return `The selection has no open paths to close.${skippedNote}`;
  const paths = closed === 1 ? '1 path' : `${closed} paths`;
  const gap =
    longestGapMm < 0.001
      ? ''
      : ` The widest gap closed was ${formatDisplayMillimetres(longestGapMm)} mm.`;
  return `Closed ${paths}.${gap}${skippedNote}`;
}

function reverseMessage(reversed: number, openMayFlip: boolean): string {
  if (reversed === 0) {
    return 'Nothing to reverse: select imported, traced or drawn-line artwork. Text and drawn shapes keep their own direction.';
  }
  const paths = reversed === 1 ? '1 path' : `${reversed} paths`;
  const note = openMayFlip
    ? ' Open paths can still be cut from either end: set Path direction to Preserve direction in the Cut Planner to keep it.'
    : '';
  return `Reversed ${paths}.${note}`;
}

function toast(message: string): void {
  useToastStore.getState().pushToast(message, 'info');
}
