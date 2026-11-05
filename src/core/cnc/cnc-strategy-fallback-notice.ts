// What an operation cuts instead of the strategy it asks for, and why, in the
// words Preview, Job Review and the Save/Start advisories all use, so the
// operator reads one explanation wherever they meet it (performance audit
// S8-P2-1).

// Deep type import: core/job's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type { CncStrategyFallback } from '../job/cnc-compilation-sidecar-types';

/** The verifier's engagement refusal (adaptive-pocket-verifier.ts). */
export const ADAPTIVE_ENGAGEMENT_REFUSAL =
  'Adaptive verification simulated radial engagement above the configured limit.';

export function cncStrategyFallbackNotice(
  fallback: Pick<CncStrategyFallback, 'kind' | 'reason'>,
): string {
  if (fallback.kind === 'rest-full-pocket') {
    return (
      'Rest machining will clear the whole pocket with the finishing bit instead: ' +
      `${fallback.reason} No previous-stock subtraction is used.`
    );
  }
  // ADR-154 Amendment 3: one entry helix cannot open a pocket longer than it
  // is wide, its first ring past the helix being a full slot, and no Radial
  // engagement below the 50% cap changes that. That is what this refusal
  // almost always is, so the notice names it and offers no Radial advice.
  if (fallback.reason === ADAPTIVE_ENGAGEMENT_REFUSAL) {
    return (
      "Adaptive can't open this pocket from one entry, so it will cut offset rings instead " +
      '(full-width first pass). Pockets longer than they are wide do this. Choose Offset ' +
      'rings to remove this notice.'
    );
  }
  return (
    `Adaptive will cut offset rings instead: ${fallback.reason} ` +
    'Choose Offset rings to remove this notice.'
  );
}
