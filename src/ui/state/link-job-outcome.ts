// What every controller-link job carries (ADR-705 Amendment 7, C2 verification
// E2-P3-2): the warnings it shows from its Frame on (the route's own advisories
// and the shared job warnings, each line once) and the completion that runs the
// "After completed job" variable advance. The type is branded, and only
// linkJobOutcome makes one, from the shared link request and the shared job
// warnings. A link store's Frame and Start take a job that spreads one in
// (connectLinkStore requires it), so a fourth link route that compiles without
// the request, the warnings or the completion does not compile.

import type { SharedJobWarnings } from '../laser/shared-job-warnings';
import type { LinkJobRequest } from './link-job-request';

declare const linkJobOutcomeBrand: unique symbol;

export type LinkJobOutcome = {
  /** The route's advisories and the shared job warnings, each line once. */
  readonly advisories: ReadonlyArray<string>;
  /** Runs once the machine reports the job finished: the variable advance. */
  readonly completed: () => void;
  readonly [linkJobOutcomeBrand]: true;
};

export function linkJobOutcome(
  request: LinkJobRequest,
  routeAdvisories: ReadonlyArray<string>,
  jobWarnings: SharedJobWarnings,
): LinkJobOutcome {
  // Each line once: the panel and the job bar key their lists by the text.
  const advisories = [...new Set([...routeAdvisories, ...jobWarnings])];
  return { advisories, completed: request.completed } as unknown as LinkJobOutcome;
}
