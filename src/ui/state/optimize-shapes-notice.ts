// The words Optimize Shapes (LightBurn gap LBG-T22) uses: the dialog's status
// line before Apply ("12,480 points become 214 segments; nothing moves more
// than 0.05 mm.") and the notice after it, in the past tense.

import type { ShapeOptimizeStats } from '../../core/geometry/shape-optimize/optimize-object';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import type { OptimizeShapesPlan, OptimizeShapesSelection } from './optimize-shapes-plan';

type Tense = 'status' | 'notice';

// Below this an outline has not moved at all, only been rewritten.
const UNMOVED_MM = 0.0005;

/** Why there is nothing to work on, or null when the selection has vector artwork to optimize. */
export function optimizeShapesSelectionProblem(selection: OptimizeShapesSelection): string | null {
  if (selection.targets.length > 0) return null;
  if (selection.locked > 0) {
    return selection.locked === 1
      ? 'The selected artwork is locked, so it is left as it is. Unlock it to optimize it.'
      : 'The selected artwork is all locked, so it is left as it is. Unlock it to optimize it.';
  }
  return 'Select imported, traced or drawn vector artwork to optimize first.';
}

/** The dialog's status line for a finished plan. */
export function optimizeShapesStatus(plan: OptimizeShapesPlan, locked: number): string {
  if (plan.stats.changedContours === 0) {
    return `Nothing to change: these settings leave the selected outlines as they are.${lockedNote(locked, 'status')}`;
  }
  return `${summary(plan.stats, 'status')}${convertedNote(plan, 'status')}${lockedNote(locked, 'status')}`;
}

/** The notice after Apply. */
export function optimizeShapesNotice(
  plan: OptimizeShapesPlan,
  changedObjects: number,
  locked: number,
): string {
  if (changedObjects === 0) {
    return `Nothing changed: these settings leave the selected outlines as they are.${lockedNote(locked, 'notice')}`;
  }
  const objects = changedObjects === 1 ? '1 object' : `${changedObjects} objects`;
  return `Optimized ${objects}: ${summary(plan.stats, 'notice')}${convertedNote(plan, 'notice')}${lockedNote(locked, 'notice')}`;
}

function summary(stats: ShapeOptimizeStats, tense: Tense): string {
  const points = count(stats.sourcePoints, 'point', 'points');
  const segments = count(stats.segments, 'segment', 'segments');
  const become = tense === 'status' ? 'become' : 'became';
  return `${points} ${become} ${segments}; ${movedClause(stats.movedMm, tense)}.`;
}

function movedClause(movedMm: number, tense: Tense): string {
  if (movedMm < UNMOVED_MM) {
    return tense === 'status' ? 'the outlines do not move' : 'the outlines did not move';
  }
  // Rounded up, so "no more than" stays true.
  const shown = formatDisplayMillimetres(Math.ceil(movedMm * 1000) / 1000);
  return `nothing ${tense === 'status' ? 'moves' : 'moved'} more than ${shown} mm`;
}

function convertedNote(
  plan: Pick<OptimizeShapesPlan, 'convertedText' | 'convertedShapes'>,
  tense: Tense,
): string {
  const parts = [
    ...(plan.convertedText === 0 ? [] : [count(plan.convertedText, 'text object', 'text objects')]),
    ...(plan.convertedShapes === 0
      ? []
      : [count(plan.convertedShapes, 'drawn shape', 'drawn shapes')]),
  ];
  if (parts.length === 0) return '';
  const single = plan.convertedText + plan.convertedShapes === 1;
  const paths = single ? 'a path' : 'paths';
  if (tense === 'status') return ` ${parts.join(' and ')} will become ${paths}.`;
  return ` ${parts.join(' and ')} ${single ? 'was' : 'were'} converted to ${paths} in the same step; Undo restores ${single ? 'it' : 'them'}.`;
}

function lockedNote(locked: number, tense: Tense): string {
  if (locked === 0) return '';
  const verb = tense === 'status' ? 'is' : 'was';
  return locked === 1
    ? ` 1 locked object ${verb} left as it is.`
    : ` ${locked} locked objects ${tense === 'status' ? 'are' : 'were'} left as they are.`;
}

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`;
}
