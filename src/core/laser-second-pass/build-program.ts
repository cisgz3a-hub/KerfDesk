import { buildBrushIndex, validateSelection } from './brush-index';
import { partitionBrushPower } from './brush-partition';
import {
  createProgramWriter,
  finishProgram,
  selectedPower,
  writeSourceSegment,
} from './program-writer';
import { errorMessage, visitLaserSecondPassSource } from './source';
import type { LaserSecondPassProgramResult, LaserSecondPassSelection } from './types';

/**
 * Derive a new pass from the exact archived bytes. Source sweeps retain their
 * original runways, direction, feed, and tonal modulation. Only painted motion
 * receives power; whole sweeps containing no selected burn are omitted.
 *
 * Two forward passes retain only selected group IDs, not a second full route
 * or an unbounded buffer of dark moves preceding the first painted point.
 */
export function buildLaserSecondPassProgram(
  sourceGcode: string,
  selection: LaserSecondPassSelection,
): LaserSecondPassProgramResult {
  try {
    validateSelection(selection);
    const index = buildBrushIndex(selection);
    const groups = new Set<number>();
    visitLaserSecondPassSource(sourceGcode, selection.initialPosition, (segment) => {
      if (segment.rapid || segment.power <= 0 || groups.has(segment.group)) return;
      const intervals = partitionBrushPower(segment, index, selection.strokes);
      if (
        intervals.some(
          (interval) => selectedPower(segment.power, interval.scale, selection.maxPowerS) > 0,
        )
      ) {
        groups.add(segment.group);
      }
    });
    const writer = createProgramWriter(selection, index);
    visitLaserSecondPassSource(sourceGcode, selection.initialPosition, (segment) => {
      if (!segment.rapid && groups.has(segment.group)) writeSourceSegment(writer, segment);
    });
    return { kind: 'ready', ...finishProgram(writer) };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}
