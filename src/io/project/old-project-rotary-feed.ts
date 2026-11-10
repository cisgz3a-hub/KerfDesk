// Rotary strokes an upgraded project burns differently (ADR-127 Amendment 2,
// rolling audit v13 Y5-P2-2). KerfDesk 1.0.30 and earlier (schema 21 and
// below) wrote the layer speed as the feed of every rotary move, so a stroke
// round the part moved its surface at speed ÷ k. Now it moves at the layer
// speed, so such strokes burn 1/k times the energy they did: 6.28x on an Ø80
// glass in the Creality chuck, less on a k > 1 roller. ADR-682 Amendment 3:
// what the file holds raises the notice, not the release notes.

import { isRotaryActive, rotaryYScale } from '../../core/devices';
import { outputOperationLayers, sceneObjectUsesOperation, type Project } from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';

/** The schema 1.0.31 saves, the first whose rotary moves were matched. */
export const FIRST_MATCHED_FEED_SCHEMA = 22;

export type RotaryFeedChange = { readonly yScale: number };

/** At most one entry: this project's rotary scale when its line, cut or fill
 *  output now burns round the part with another energy than before. */
export function rotaryFeedChange(project: Project): ReadonlyArray<RotaryFeedChange> {
  if (project.machine?.kind === 'cnc') return [];
  const rotary = project.device.rotary;
  if (!isRotaryActive(rotary)) return [];
  const yScale = rotaryYScale(rotary);
  if (yScale === 1 || !hasVectorOutput(project)) return [];
  return [{ yScale }];
}

function hasVectorOutput(project: Project): boolean {
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  return project.scene.objects.some((object) =>
    operations.some(
      (operation) =>
        sceneObjectUsesOperation(object, operation) &&
        effectiveOperationForObject(operation, object).mode !== 'image',
    ),
  );
}

/** The words for the load notice and Job Review. */
export function rotaryFeedChangeMessage(change: RotaryFeedChange): string {
  const factor = 1 / change.yScale;
  const times = factor >= 10 ? factor.toFixed(1) : factor.toFixed(2);
  const direction =
    factor > 1
      ? `up to ${times}× the energy they did, because KerfDesk 1.0.30 and earlier ran them faster than the speed you set`
      : `as little as ${times}× the energy they did, because KerfDesk 1.0.30 and earlier ran them slower than the speed you set`;
  return (
    `On this rotary, strokes round the part now move it at the layer speed, so they burn ` +
    `${direction}. If you tuned power or speed for the old burn, set them again and run a test ` +
    'before you burn real stock.'
  );
}
