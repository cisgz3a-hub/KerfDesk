// Rotary bounds (ADR-127 Amendment 1). With the rotary on, program Y is a turn
// of the object, not a place on the bed: a placed job sits wherever its anchor
// put it, and the cylinder has no rails. Only the Y extent can be checked, against
// one turn (the wrap limit); X keeps the bed's own check.
import type { machineBoundsForDevice } from '../devices';
import { programMotionYSpan } from './relative-motion-envelope';

type MachineBounds = ReturnType<typeof machineBoundsForDevice>;

/** The wrap limit, or null when no usable rotary limit applies. */
export function rotaryWrapLimit(overrideMm: number | undefined): number | null {
  return overrideMm === undefined || !Number.isFinite(overrideMm) || overrideMm <= 0
    ? null
    : overrideMm;
}

/** The bed with no Y limits, so the position checks look at X only. */
export function rotaryXOnlyBounds(bounds: MachineBounds): MachineBounds {
  return {
    ...bounds,
    height: Number.POSITIVE_INFINITY,
    minY: Number.NEGATIVE_INFINITY,
    maxY: Number.POSITIVE_INFINITY,
  };
}

/** A program taller than one turn burns onto its own start. */
export function rotaryWrapIssue(gcodeLines: ReadonlyArray<string>, wrapMm: number): string | null {
  const span = programMotionYSpan(gcodeLines);
  if (span === null || span <= wrapMm) return null;
  return (
    `Rotary job motion spans ${span.toFixed(3)} mm in Y, more than one turn of the object ` +
    `(${wrapMm.toFixed(3)} mm), so it would burn over its own start. Scale the artwork down ` +
    'or check the rotary setup.'
  );
}
