// How heavy an interval autosave of a project is (ADR-305 Amendment 1).
//
// With serialisation, validation and the IndexedDB commit all in the worker,
// two costs still grow with the project, and a running job cares about both:
//
//   * The hand-off, on the canvas thread: postMessage structured-clones
//     everything that is not packed vector geometry, and the packed geometry
//     is copied into the buffers it transfers (ADR-346). While a job streams,
//     that thread also refills the controller on the window route and carries
//     Abort.
//   * The copy itself, in the worker: the project, its text, the validating
//     parse of that text and the snapshots being rotated are all in memory at
//     once. On a PC short of memory, hundreds of megabytes of that stalled
//     every process for 70-870 ms in the measurement, the job's with them.
//
// The unit is one character of the recovery copy's text, which is also about
// 0.7-1 ns of hand-off for embedded text. Measured in Chrome against a
// streaming job (docs/audits/2026-11-11-annoyance-a1/F5-fix-autosave.md): 22
// million characters of photo cost 6-27 ms to hand over, 88 million 53-80 ms
// and 10,000 small objects 21-46 ms. It is an estimate for a threshold, not a
// timing: the gate also measures each real hand-off.

import type { ColoredPath, Project } from '../../core/scene';

/** A scene object's own small fields, cloned one property at a time. */
const OBJECT_WEIGHT = 4_000;
/**
 * A vertex. It is cheap to hand over (two doubles in a transferred buffer,
 * 8 ms for a million), so its weight is what it adds to the copy: a
 * 1,000,000-point trace made 71 million characters of text.
 */
const POINT_WEIGHT = 64;

// Store slices replace an edited value and never mutate one in place, so a
// weight stays true for as long as the value it was taken from exists. Only
// the document's top-level values and its scene objects are remembered: a tick
// then re-weighs what an edit replaced, not the whole document.
const remembered = new WeakMap<object, number>();

export function autosaveHandOffWeight(project: Project): number {
  let weight = 0;
  for (const [key, value] of Object.entries(project)) {
    if (key !== 'scene') weight += rememberedWeight(value);
  }
  for (const [key, value] of Object.entries(project.scene)) {
    if (key !== 'objects') weight += rememberedWeight(value);
  }
  for (const object of project.scene.objects) weight += OBJECT_WEIGHT + rememberedWeight(object);
  return weight;
}

function rememberedWeight(value: unknown): number {
  if (typeof value !== 'object' || value === null) return weigh(value);
  const known = remembered.get(value);
  if (known !== undefined) return known;
  const weight = weigh(value);
  remembered.set(value, weight);
  return weight;
}

function weigh(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (typeof value !== 'object' || value === null) return 0;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value.byteLength;
  if (Array.isArray(value)) {
    let weight = 0;
    for (const item of value) weight += weigh(item);
    return weight;
  }
  let weight = 0;
  for (const [key, field] of Object.entries(value)) {
    // Vector geometry is counted by its vertices, never walked point by
    // point: a dense trace holds a million of them.
    weight += key === 'paths' && Array.isArray(field) ? pathsWeight(field) : weigh(field);
  }
  return weight;
}

function pathsWeight(paths: ReadonlyArray<Partial<ColoredPath>>): number {
  let points = 0;
  for (const path of paths) {
    for (const polyline of path.polylines ?? []) points += polyline.points.length;
    for (const curve of path.curves ?? []) points += curve.segments.length;
  }
  return points * POINT_WEIGHT;
}
