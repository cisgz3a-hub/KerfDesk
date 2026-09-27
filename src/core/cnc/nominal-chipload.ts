import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';

/** Programmed chipload, not measured chip thickness at a corner or during acceleration. */
export function nominalChiploadMm(
  feedMmPerMin: number,
  spindleRpm: number,
  flutes: number,
): number | null {
  if (![feedMmPerMin, spindleRpm, flutes].every((value) => Number.isFinite(value) && value > 0))
    return null;
  // Match the emitter's feed representation and whole-number S word.
  const rpm = Math.round(spindleRpm);
  if (rpm < 1) return null;
  return effectiveGcodeFeedMmPerMin(feedMmPerMin) / (rpm * Math.max(1, Math.round(flutes)));
}
