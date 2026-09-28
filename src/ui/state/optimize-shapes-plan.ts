// What Optimize Shapes (LightBurn gap LBG-T22) does to the selection, shared by
// the dialog's live status line and Apply so the user gets what the status
// promised. The dialog works through the contours a slice of time at a time;
// Apply takes the dialog's finished results for every object that has not
// changed since, and works out the rest itself.
//
// Imported and traced artwork and drawn lines keep their object; only their
// paths change. Text and drawn rectangles, ellipses, polygons, stars and
// barcodes rebuild their paths from their settings, so an outline that changes
// becomes plain paths, as Trim Shapes makes them (keeping placement, exact
// curves, operations and tab anchors). Locked artwork is left alone.

import { localPathArtwork } from '../../core/geometry/local-path-artwork';
import {
  addShapeOptimizeStats,
  EMPTY_SHAPE_OPTIMIZE_STATS,
  objectOptimizer,
  type ObjectOptimization,
  type ShapeOptimizeStats,
} from '../../core/geometry/shape-optimize/optimize-object';
import type { ShapeOptimizeOptions } from '../../core/geometry/shape-optimize/shape-optimize-options';
import {
  boundsForPaths,
  isVectorPathObject,
  type VectorSceneObject,
} from '../../core/geometry/vector-path-tools';
import { isRegistrationBox } from '../../core/scene/registration-layer';
import type { Scene } from '../../core/scene/scene';
import type { SceneObject } from '../../core/scene/scene-object';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';

export type OptimizeShapesSelection = {
  /** Unlocked vector artwork in the selection, in stacking order. */
  readonly targets: ReadonlyArray<VectorSceneObject>;
  readonly locked: number;
};

export type OptimizedObject = {
  readonly source: VectorSceneObject;
  readonly result: ObjectOptimization;
};

export type OptimizeShapesPlan = {
  readonly options: ShapeOptimizeOptions;
  readonly objects: ReadonlyArray<OptimizedObject>;
  readonly stats: ShapeOptimizeStats;
  /** Changed objects that become plain paths: text, and drawn shapes other than lines. */
  readonly convertedText: number;
  readonly convertedShapes: number;
};

export type OptimizeShapesRun = {
  /** Works for about `budgetMs` (at least one contour); true once the plan is complete. */
  readonly advance: (budgetMs: number) => boolean;
  /** Share of the source done, 0 to 1. */
  readonly progress: () => number;
  readonly plan: () => OptimizeShapesPlan;
};

export function optimizeShapesSelection(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
): OptimizeShapesSelection {
  const ids = new Set(selectedIds);
  const targets: VectorSceneObject[] = [];
  let locked = 0;
  for (const object of scene.objects) {
    if (!ids.has(object.id) || !isVectorPathObject(object) || isRegistrationBox(object)) continue;
    if (object.locked === true) locked += 1;
    else targets.push(object);
  }
  return { targets, locked };
}

export function startOptimizeShapes(
  targets: ReadonlyArray<VectorSceneObject>,
  options: ShapeOptimizeOptions,
  now: () => number = () => performance.now(),
): OptimizeShapesRun {
  const optimizers = targets.map((object) => ({ object, run: objectOptimizer(object, options) }));
  const total = optimizers.reduce((sum, entry) => sum + entry.run.progress().total, 0);
  let current = 0;
  let doneSegments = 0;
  const advance = (budgetMs: number): boolean => {
    const until = now() + budgetMs;
    do {
      const entry = optimizers[current];
      if (entry === undefined) return true;
      const before = entry.run.progress().done;
      if (!entry.run.step()) current += 1;
      doneSegments += entry.run.progress().done - before;
    } while (now() < until);
    return current >= optimizers.length;
  };
  return {
    advance,
    progress: () => (total === 0 ? 1 : doneSegments / total),
    plan: () => {
      if (current < optimizers.length) advance(Number.POSITIVE_INFINITY);
      return completedPlan(
        options,
        optimizers.map((entry) => ({ source: entry.object, result: entry.run.result() })),
      );
    },
  };
}

/** The whole plan at once. */
export function planOptimizeShapes(
  targets: ReadonlyArray<VectorSceneObject>,
  options: ShapeOptimizeOptions,
): OptimizeShapesPlan {
  return startOptimizeShapes(targets, options).plan();
}

/**
 * The plan for the targets, taking each object's result from `ready` when it
 * was worked out for that very object with the same options.
 */
export function planReusing(
  targets: ReadonlyArray<VectorSceneObject>,
  options: ShapeOptimizeOptions,
  ready: OptimizeShapesPlan | null,
): OptimizeShapesPlan {
  const reusable = ready !== null && sameOptions(ready.options, options) ? ready : null;
  const objects = targets.map((object) => {
    const done = reusable?.objects.find((entry) => entry.source === object);
    return done ?? planOptimizeShapes([object], options).objects[0];
  });
  return completedPlan(
    options,
    objects.filter((entry): entry is OptimizedObject => entry !== undefined),
  );
}

/** The object with its optimized paths, or null when none of them changed. */
export function optimizedSceneObject(entry: OptimizedObject): SceneObject | null {
  const { source: object, result } = entry;
  if (result.paths === object.paths) return null;
  const bounds = boundsForPaths(result.paths) ?? object.bounds;
  if (object.kind === 'imported-svg' || object.kind === 'traced-image') {
    return { ...object, paths: result.paths, bounds };
  }
  if (object.kind === 'shape' && object.spec.kind === 'polyline') {
    const kept = synchronizePolylineShapeGeometry(object, result.paths, bounds);
    if (kept !== null) return kept;
  }
  return { ...localPathArtwork(object), paths: result.paths, bounds };
}

function completedPlan(
  options: ShapeOptimizeOptions,
  objects: ReadonlyArray<OptimizedObject>,
): OptimizeShapesPlan {
  let stats = EMPTY_SHAPE_OPTIMIZE_STATS;
  let convertedText = 0;
  let convertedShapes = 0;
  for (const entry of objects) {
    stats = addShapeOptimizeStats(stats, entry.result.stats);
    if (entry.result.paths === entry.source.paths) continue;
    if (entry.source.kind === 'text') convertedText += 1;
    else if (becomesPaths(entry)) convertedShapes += 1;
  }
  return { options, objects, stats, convertedText, convertedShapes };
}

// A drawn line keeps its object while it stays one path of one contour.
function becomesPaths(entry: OptimizedObject): boolean {
  const object = entry.source;
  if (object.kind !== 'shape') return false;
  if (object.spec.kind !== 'polyline') return true;
  return optimizedSceneObject(entry)?.kind === 'imported-svg';
}

function sameOptions(a: ShapeOptimizeOptions, b: ShapeOptimizeOptions): boolean {
  return (
    a.smooth === b.smooth &&
    a.smoothingMm === b.smoothingMm &&
    a.cornerAngleDeg === b.cornerAngleDeg &&
    a.fit === b.fit &&
    a.fitToleranceMm === b.fitToleranceMm &&
    a.fitWith === b.fitWith
  );
}
