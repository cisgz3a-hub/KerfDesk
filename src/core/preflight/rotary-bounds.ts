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

/** What the operator measured: the rotary's machine Y mm per surface mm and
 * the object's diameter, so the warning speaks the artwork's own units. */
export type RotaryWrapSurface = {
  readonly yScale: number;
  readonly objectDiameterMm: number;
};

/** A program taller than one turn burns onto its own start. */
export function rotaryWrapIssue(
  gcodeLines: string | Iterable<string>,
  wrapMm: number,
  surface?: RotaryWrapSurface,
): string | null {
  const span = programMotionYSpan(gcodeLines);
  if (span === null || span <= wrapMm) return null;
  if (surface !== undefined && surface.yScale > 0 && Number.isFinite(surface.yScale)) {
    // Rolling audit v12 X8-P3-1: surface mm and turns, as Rotary Setup's
    // wrap preview names them, never the machine millimetres behind them.
    const turnMm = Math.PI * surface.objectDiameterMm;
    return (
      `The artwork wraps ${(span / surface.yScale).toFixed(1)} mm round the part ` +
      `(${(span / wrapMm).toFixed(2)} turns), more than one turn of the ` +
      `Ø${Number(surface.objectDiameterMm.toFixed(2))} mm object (${turnMm.toFixed(1)} mm), ` +
      'so it would burn over its own start. Scale the artwork down or check the rotary setup.'
    );
  }
  return (
    `Rotary job motion spans ${span.toFixed(3)} mm in Y, more than one turn of the object ` +
    `(${wrapMm.toFixed(3)} mm), so it would burn over its own start. Scale the artwork down ` +
    'or check the rotary setup.'
  );
}
