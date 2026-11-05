// What an operation cuts instead of the strategy it asks for, and why, in the
// words Preview, Job Review and the Save/Start advisories all use, so the
// operator reads one explanation wherever they meet it (performance audit
// S8-P2-1).

// Deep type import: core/job's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type { CncStrategyFallback } from '../job/cnc-compilation-sidecar-types';
import { ADAPTIVE_ENGAGEMENT_REFUSAL, ADAPTIVE_OPENING_REFUSAL } from './adaptive-pocket-verifier';

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
  // is wide, and no Radial engagement below the 50% cap changes that, so the
  // notice offers none.
  if (fallback.reason === ADAPTIVE_OPENING_REFUSAL) {
    return (
      "Adaptive can't open this pocket from one entry, so it will cut offset rings instead " +
      '(full-width first pass). Choose Offset rings to remove this notice.'
    );
  }
  if (fallback.reason === ADAPTIVE_ENGAGEMENT_REFUSAL) {
    return (
      'Adaptive will cut offset rings instead: a later ring would cut wider than Radial ' +
      'engagement allows. Choose Offset rings to remove this notice.'
    );
  }
  return (
    `Adaptive will cut offset rings instead: ${fallback.reason} ` +
    'Choose Offset rings to remove this notice.'
  );
}
