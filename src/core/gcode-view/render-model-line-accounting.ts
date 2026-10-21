import type { ProgramBoundsTracker } from './program-bounds';
import type { applyLineWords } from './render-model-words';
import { LINE_CATEGORY, type SkippedMotion } from './render-model-types';

/** A controller-specific reader could not place this line. Later relative
 * moves cannot restore its position; an unknown origin cannot be restored
 * merely by another absolute coordinate either. */
export function recordUnplacedLine(
  context: { readonly program: ProgramBoundsTracker; readonly skipped: SkippedMotion[] },
  line: number,
  unplaced?: 'position' | 'origin',
): void {
  if (unplaced === undefined) return;
  context.program.forget([]);
  if (unplaced === 'origin') context.program.displace(['X', 'Y', 'Z']);
  context.skipped.push({ line, reason: 'controller-dependent motion or coordinates' });
}

export function nonMotionCategory(
  outcome: ReturnType<typeof applyLineWords>,
  hasNativeEvent: boolean,
): number {
  if (outcome.sawEvent || hasNativeEvent) return LINE_CATEGORY.event;
  if (outcome.sawModal) return LINE_CATEGORY.modalOnly;
  if (outcome.sawUnsupported) return LINE_CATEGORY.unsupported;
  return LINE_CATEGORY.modalOnly;
}
