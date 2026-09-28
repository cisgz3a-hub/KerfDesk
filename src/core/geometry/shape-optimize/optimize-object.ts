// Optimize Shapes on one object's paths (LightBurn gap LBG-T22), one contour
// at a time so a dialog can spread a large trace over several frames. Every
// contour keeps its place in its path, so tab anchors, which name a contour by
// path and index, still point at it.
//
// A path whose curves pair one to one with its polylines is optimized from its
// exact curves; a path of plain polylines from its points. A path whose curves
// do not pair up is left alone, as Trim Shapes leaves it. A contour left open
// whose ends meet is treated as the closed outline it draws, and keeps its
// open flag. The compatibility polylines of a changed path are rebuilt from its
// new curves, as the node tools rebuild them; a path that was plain polylines
// and comes out as straight lines only stays plain polylines.

import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  polylineToCurveSubpath,
} from '../../scene/curve-path';
import { CLOSURE_EPS_MM, isClosedEnough } from '../../scene/polyline-closure';
import type {
  ColoredPath,
  CurveSubpath,
  Polyline,
  Transform,
  Vec2,
} from '../../scene/scene-object';
import type { VectorSceneObject } from '../vector-path-tools';
import { optimizeContour } from './optimize-contour';
import type { ShapeOptimizeOptions } from './shape-optimize-options';

export type ShapeOptimizeStats = {
  /** Points (curve nodes) the contours had. */
  readonly sourcePoints: number;
  /** Segments the contours have afterwards, changed or not. */
  readonly segments: number;
  /** Farthest any outline moved, world mm. */
  readonly movedMm: number;
  readonly contours: number;
  readonly changedContours: number;
};

export const EMPTY_SHAPE_OPTIMIZE_STATS: ShapeOptimizeStats = {
  sourcePoints: 0,
  segments: 0,
  movedMm: 0,
  contours: 0,
  changedContours: 0,
};

export type ObjectOptimization = {
  /** The object's paths afterwards; the same array when nothing changed. */
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly stats: ShapeOptimizeStats;
};

export type ObjectOptimizer = {
  /** Optimizes the next contour; false once every contour is done. */
  readonly step: () => boolean;
  /** Source segments in the contours done so far, and in all of them. */
  readonly progress: () => { readonly done: number; readonly total: number };
  readonly result: () => ObjectOptimization;
};

type ContourTask = {
  readonly pathIndex: number;
  readonly contourIndex: number;
  readonly source: CurveSubpath;
  /** The outline closes although its flag says open. */
  readonly endsMeet: boolean;
};

export function addShapeOptimizeStats(
  a: ShapeOptimizeStats,
  b: ShapeOptimizeStats,
): ShapeOptimizeStats {
  return {
    sourcePoints: a.sourcePoints + b.sourcePoints,
    segments: a.segments + b.segments,
    movedMm: Math.max(a.movedMm, b.movedMm),
    contours: a.contours + b.contours,
    changedContours: a.changedContours + b.changedContours,
  };
}

export function optimizeObjectPaths(
  object: VectorSceneObject,
  options: ShapeOptimizeOptions,
): ObjectOptimization {
  const optimizer = objectOptimizer(object, options);
  while (optimizer.step());
  return optimizer.result();
}

export function objectOptimizer(
  object: VectorSceneObject,
  options: ShapeOptimizeOptions,
): ObjectOptimizer {
  const tasks = contourTasks(object.paths);
  const total = tasks.reduce((sum, task) => sum + task.source.segments.length, 0);
  const results = new Map<string, CurveSubpath>();
  let stats = EMPTY_SHAPE_OPTIMIZE_STATS;
  let next = 0;
  let done = 0;
  return {
    step: () => {
      const task = tasks[next];
      if (task === undefined) return false;
      next += 1;
      done += task.source.segments.length;
      const outcome = optimizeTask(task, object.transform, options);
      stats = addShapeOptimizeStats(stats, outcome.stats);
      if (outcome.curve !== null) results.set(taskKey(task), outcome.curve);
      return next < tasks.length;
    },
    progress: () => ({ done, total }),
    result: () => ({
      paths: results.size === 0 ? object.paths : rebuiltPaths(object, results),
      stats,
    }),
  };
}

function contourTasks(paths: ReadonlyArray<ColoredPath>): ContourTask[] {
  const tasks: ContourTask[] = [];
  paths.forEach((path, pathIndex) => {
    if (path.curves !== undefined && path.curves.length !== path.polylines.length) return;
    path.polylines.forEach((polyline, contourIndex) => {
      const curve = path.curves?.[contourIndex];
      const source = curve ?? polylineToCurveSubpath(polyline);
      if (source.segments.length === 0) return;
      const endsMeet =
        !source.closed && (curve === undefined ? isClosedEnough(polyline) : curveEndsMeet(curve));
      tasks.push({ pathIndex, contourIndex, source, endsMeet });
    });
  });
  return tasks;
}

function optimizeTask(
  task: ContourTask,
  transform: Transform,
  options: ShapeOptimizeOptions,
): { readonly curve: CurveSubpath | null; readonly stats: ShapeOptimizeStats } {
  const source = task.endsMeet ? { ...task.source, closed: true } : task.source;
  const result = optimizeContour(source, transform, options);
  const stats: ShapeOptimizeStats = {
    sourcePoints: result.sourcePoints,
    segments: result.segments,
    movedMm: result.movedMm,
    contours: 1,
    changedContours: result.changed ? 1 : 0,
  };
  if (!result.changed) return { curve: null, stats };
  return { curve: task.endsMeet ? { ...result.curve, closed: false } : result.curve, stats };
}

function rebuiltPaths(
  object: VectorSceneObject,
  results: ReadonlyMap<string, CurveSubpath>,
): ColoredPath[] {
  const scale = Math.max(Math.abs(object.transform.scaleX), Math.abs(object.transform.scaleY));
  const toleranceMm =
    scale > 0 && Number.isFinite(scale)
      ? DEFAULT_MACHINE_CURVE_TOLERANCE_MM / scale
      : DEFAULT_MACHINE_CURVE_TOLERANCE_MM;
  return object.paths.map((path, pathIndex) => {
    const changed = path.polylines.map((_polyline, index) =>
      results.get(taskKey({ pathIndex, contourIndex: index })),
    );
    if (changed.every((curve) => curve === undefined)) return path;
    const curves = path.polylines.map(
      (polyline, index) =>
        changed[index] ?? path.curves?.[index] ?? polylineToCurveSubpath(polyline),
    );
    if (path.curves === undefined && curves.every(allLines)) {
      const polylines = path.polylines.map((polyline, index) => {
        const curve = changed[index];
        return curve === undefined ? polyline : nodePolyline(curve);
      });
      return { ...path, polylines };
    }
    const polylines = path.polylines.map((polyline, index) => {
      const curve = changed[index];
      return curve === undefined ? polyline : flattenedPolyline(curve, toleranceMm);
    });
    return { ...path, polylines, curves };
  });
}

function taskKey(task: Pick<ContourTask, 'pathIndex' | 'contourIndex'>): string {
  return `${task.pathIndex}:${task.contourIndex}`;
}

function allLines(curve: CurveSubpath): boolean {
  return curve.segments.every((segment) => segment.kind === 'line');
}

// A closed contour's polyline does not repeat its first point; its flag closes it.
function nodePolyline(curve: CurveSubpath): Polyline {
  const points: Vec2[] = [curve.start, ...curve.segments.map((segment) => segment.to)];
  if (curve.closed && points.length > 2 && samePoint(points[0] as Vec2, points.at(-1) as Vec2)) {
    points.pop();
  }
  return { points, closed: curve.closed };
}

function flattenedPolyline(curve: CurveSubpath, toleranceMm: number): Polyline {
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  return flattened.kind === 'ok' ? flattened.polyline : nodePolyline(curve);
}

// A curve left open whose ends meet is drawn closed, like isClosedEnough's polylines.
function curveEndsMeet(curve: CurveSubpath): boolean {
  const end = curve.segments.at(-1)?.to;
  return (
    end !== undefined &&
    curve.segments.length > 1 &&
    Math.abs(end.x - curve.start.x) < CLOSURE_EPS_MM &&
    Math.abs(end.y - curve.start.y) < CLOSURE_EPS_MM
  );
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
