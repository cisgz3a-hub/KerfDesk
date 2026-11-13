// The feed, plunge and spindle words one CNC group sends (ADR-233 Amendment 1).
//
// A layer's feed is a chip-load decision made at its RPM: feed = RPM × flutes ×
// chip load (feeds-calculator.ts). When the operation asks for more RPM than the
// machine's Spindle maximum, S is capped to that maximum, and the feed and plunge
// are scaled by the same ratio so each tooth keeps the chip load planned at the
// requested RPM. Keeping the feed instead raised the chip load by the ratio:
// a 1/16" bit planned at 24,000 RPM and F1440 ran at S9000 F1440, 2.7× its chip
// load (CNC audit v3 N6-P2-1). The job runs slower; the group records what the
// operation asked for so Job Review and the program comments can say so.
import type { CncGroup } from '../job';

const MIN_FEED_MM_PER_MIN = 1;

export type CncRequestedRates = {
  /** The feed the group's cutting moves name (a drill cycle names its plunge). */
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
};

export type CncCuttingRates = Pick<
  CncGroup,
  'feedMmPerMin' | 'plungeMmPerMin' | 'spindleRpm' | 'spindleCap'
>;

export function capFeed(feedMmPerMin: number, maxFeed: number): number {
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) return MIN_FEED_MM_PER_MIN;
  return Math.min(feedMmPerMin, maxFeed);
}

export function capSpindle(spindleRpm: number, spindleMaxRpm: number): number {
  if (!Number.isFinite(spindleRpm) || spindleRpm <= 0) return 0;
  return Math.min(spindleRpm, spindleMaxRpm);
}

/**
 * The share of the requested RPM the machine can run, in (0, 1]. 1 when the
 * request fits, or when there is no positive request to scale (a non-positive
 * RPM is refused by preflight, not scaled).
 */
export function spindleCapRatio(spindleRpm: number, spindleMaxRpm: number): number {
  const sent = capSpindle(spindleRpm, spindleMaxRpm);
  return sent > 0 && sent < spindleRpm ? sent / spindleRpm : 1;
}

/** Cap S to the Spindle maximum, scale F and plunge with it, then cap both to Max feed. */
export function cncCuttingRates(
  requested: CncRequestedRates,
  maxFeed: number,
  spindleMaxRpm: number,
): CncCuttingRates {
  const ratio = spindleCapRatio(requested.spindleRpm, spindleMaxRpm);
  const rates = {
    feedMmPerMin: capFeed(requested.feedMmPerMin * ratio, maxFeed),
    plungeMmPerMin: capFeed(requested.plungeMmPerMin * ratio, maxFeed),
    spindleRpm: capSpindle(requested.spindleRpm, spindleMaxRpm),
  };
  if (ratio === 1) return rates;
  return {
    ...rates,
    spindleCap: {
      requestedRpm: requested.spindleRpm,
      requestedFeedMmPerMin: requested.feedMmPerMin,
      requestedPlungeMmPerMin: requested.plungeMmPerMin,
    },
  };
}
