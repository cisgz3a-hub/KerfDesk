import type { PreflightResult } from '../../core/preflight';
import type { ReliefMaterializationFailure } from '../../core/relief/relief-materialization-failure';

/** Map a pure relief compile failure onto the one compile-integrity warning surface. */
export function reliefMaterializationFailure(
  failure: ReliefMaterializationFailure,
): PreflightResult {
  return {
    ok: false,
    issues: [
      {
        code: 'relief-materialization-failed',
        message:
          `Relief "${failure.source}" could not be compiled from its stored source data. ` +
          `${failure.reason} Re-import or replace that relief before preparing G-code.`,
      },
    ],
  };
}
