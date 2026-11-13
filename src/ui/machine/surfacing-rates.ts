// The feed, plunge and spindle words a surfacing program sends. Surfacing
// follows the compiler's rate rule (ADR-233 Amendment 1): a typed RPM above the
// Spindle maximum is capped, and feed and plunge are lowered by the same ratio
// so each tooth keeps the chip load planned at the typed RPM. It used to cap S
// alone and keep the feed (CNC audit v3 N7-P3-3, a sibling of N6-P2-1). The
// Surfacing panel's "after machine limits" note reads the same values.

import { cncCuttingRates, type CncCuttingRates } from '../../core/cnc/cnc-cutting-rates';
import {
  SURFACING_DEFAULT_FEED_MM_PER_MIN,
  SURFACING_DEFAULT_PLUNGE_MM_PER_MIN,
} from '../../core/cnc/surfacing';

export function surfacingSentRates(
  inputs: {
    readonly feedMmPerMin?: number;
    readonly plungeMmPerMin?: number;
    readonly spindleRpm?: number;
  },
  maxFeedMmPerMin: number,
  spindleMaxRpm: number,
): CncCuttingRates {
  const requested = {
    feedMmPerMin: inputs.feedMmPerMin ?? SURFACING_DEFAULT_FEED_MM_PER_MIN,
    plungeMmPerMin: inputs.plungeMmPerMin ?? SURFACING_DEFAULT_PLUNGE_MM_PER_MIN,
    spindleRpm: inputs.spindleRpm ?? spindleMaxRpm,
  };
  const valid = Object.values(requested).every((value) => Number.isFinite(value) && value > 0);
  // An invalid value goes through unchanged: surfacing refuses it by name
  // (validateSurfacingParams), where the shared rule would quietly send F1.
  if (!valid) {
    return {
      feedMmPerMin: Math.min(requested.feedMmPerMin, maxFeedMmPerMin),
      plungeMmPerMin: Math.min(requested.plungeMmPerMin, maxFeedMmPerMin),
      spindleRpm: Math.min(requested.spindleRpm, spindleMaxRpm),
    };
  }
  return cncCuttingRates(requested, maxFeedMmPerMin, spindleMaxRpm);
}
