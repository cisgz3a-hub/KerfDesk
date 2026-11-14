// Rotary strokes an upgraded project burns differently (ADR-127 Amendment 2,
// rolling audit v13 Y5-P2-2). KerfDesk 1.0.30 and earlier (schema 21 and
// below) wrote the layer speed as the feed of every rotary move, so a stroke
// round the part moved its surface at speed ÷ k. Now it moves at the layer
// speed, so such strokes burn 1/k times the energy they did: 6.28x on an Ø80
// glass in the Creality chuck, less on a k > 1 roller. ADR-682 Amendment 3:
// what the file holds raises the notice, not the release notes.
//
// ADR-127 Amendment 4 (rolling audit v14 Z3-P3-3): only strokes whose dose
// really changes count. A move in design direction (dx, dy) ran at a surface
// speed F · Ls / Lm and now runs at F, held at the Max feed, so its dose
// changed by max(Ls / Lm, F / Max feed). Lines along X and a 0° Fill change
// nothing; the notice names the largest real change, read from the file's
// own geometry (no compile at load).

import { isRotaryActive, rotaryYScale } from '../../core/devices';
import {
  applyTransform,
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { compilationPolylines } from '../../core/job/compilation-polylines';
import { fillHatchPassRuns } from '../../core/job/scan-pass-angles';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { maxOf, minOf } from '../../core/util';

/** The schema 1.0.31 saves, the first whose rotary moves were matched. */
export const FIRST_MATCHED_FEED_SCHEMA = 22;

/** Below this change in dose, nothing a burn can show changed. */
const CHANGE_THRESHOLD = 0.01;
const ROUND_THE_PART = Math.PI / 2;

export type RotaryFeedChange = {
  readonly yScale: number;
  /** The largest change in energy round the part: above 1 burns more now, below 1 less. */
  readonly ratio: number;
};

/** At most one entry: when some line, cut or fill stroke of this project now
 *  burns with another energy than 1.0.30 gave it. */
export function rotaryFeedChange(project: Project): ReadonlyArray<RotaryFeedChange> {
  if (project.machine?.kind === 'cnc') return [];
  const rotary = project.device.rotary;
  if (!isRotaryActive(rotary)) return [];
  const yScale = rotaryYScale(rotary);
  if (yScale === 1) return [];
  const ratios = changedDoseRatios(project, yScale);
  if (ratios.length === 0) return [];
  const ratio = yScale < 1 ? maxOf(ratios) : minOf(ratios);
  return Math.abs(ratio - 1) > CHANGE_THRESHOLD ? [{ yScale, ratio }] : [];
}

function changedDoseRatios(project: Project, yScale: number): number[] {
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  const maxFeed = project.device.maxFeed;
  const ratios: number[] = [];
  for (const object of project.scene.objects) {
    for (const operation of operations) {
      if (!sceneObjectUsesOperation(object, operation)) continue;
      const effective = effectiveOperationForObject(operation, object);
      if (effective.mode === 'image') continue;
      for (const angle of strokeAngles(effective, object)) {
        const ratio = doseRatio(angle, yScale, effective.speed, maxFeed);
        if (Math.abs(ratio - 1) > CHANGE_THRESHOLD) ratios.push(ratio);
      }
    }
  }
  return ratios;
}

/** New dose ÷ old dose of a stroke at `angle` (radians from X) in design space. */
function doseRatio(angle: number, yScale: number, speed: number, maxFeed: number): number {
  const surface = Math.hypot(Math.cos(angle), Math.sin(angle));
  const machine = Math.hypot(Math.cos(angle), yScale * Math.sin(angle));
  // The compiler held the layer at the Max feed then and now (audit of the
  // last 200 PRs, #1745), so a stored speed above it changed nothing.
  const held = maxFeed > 0 ? Math.min(speed, maxFeed) / maxFeed : 0;
  return Math.max(surface / machine, held);
}

/** The directions this operation burns the object in. A Fill burns along the
 *  hatch of each pass, as the compiler runs them (fillHatchPassRuns), and for
 *  a cross-hatch also at that angle plus 90° (fill-hatching-cache.ts); code
 *  quality audit C2 D6 (ADR-127 Amd 6). An offset Fill and a Line follow the
 *  outline, read from the object's own paths and assumed to run round the
 *  part only when it has none (ADR-127 Amd 7). */
function strokeAngles(operation: Layer, object: SceneObject): number[] {
  if (operation.mode === 'fill' && operation.fillStyle !== 'offset') {
    return fillHatchPassRuns(operation).flatMap((run) => {
      const hatch = (run.angleDeg * Math.PI) / 180;
      return operation.fillCrossHatch ? [hatch, hatch + ROUND_THE_PART] : [hatch];
    });
  }
  return outlineAngles(object);
}

// Code quality audit C2 verify E1-P2-3 (ADR-127 Amd 7): every object kind that
// carries paths (outline, shape, pen line, text, trace) is read from its own
// paths, flattened as the compiler flattens them; only an object with no paths
// is assumed to run round the part.
function outlineAngles(object: SceneObject): number[] {
  if (!('paths' in object)) return [ROUND_THE_PART];
  const angles: number[] = [];
  for (const path of object.paths) {
    for (const polyline of compilationPolylines(path, object.transform)) {
      const points = polyline.points.map((point) => applyTransform(point, object.transform));
      for (let i = 1; i < points.length; i += 1) {
        const from = points[i - 1];
        const to = points[i];
        if (from === undefined || to === undefined) continue;
        if (from.x !== to.x || from.y !== to.y) {
          angles.push(Math.atan2(to.y - from.y, to.x - from.x));
        }
      }
    }
  }
  return angles.length > 0 ? angles : [ROUND_THE_PART];
}

/** The words for the load notice and Job Review. */
export function rotaryFeedChangeMessage(change: RotaryFeedChange): string {
  const times = change.ratio >= 10 ? change.ratio.toFixed(1) : change.ratio.toFixed(2);
  const direction =
    change.ratio > 1
      ? `up to ${times}× the energy they did, because KerfDesk 1.0.30 and earlier ran them faster than the speed you set`
      : `as little as ${times}× the energy they did, because KerfDesk 1.0.30 and earlier ran them slower than the speed you set`;
  return (
    `On this rotary, strokes round the part now move it at the layer speed, so they burn ` +
    `${direction}. If you tuned power or speed for the old burn, set them again and run a test ` +
    'before you burn real stock.'
  );
}
