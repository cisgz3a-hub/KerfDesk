import type { PreflightResult } from '../../core/preflight';
import type { ReliefMaterializationError } from '../../core/relief/relief-materialization-error';

export function reliefMaterializationFailure(error: ReliefMaterializationError): PreflightResult {
  return {
    ok: false,
    issues: [
      {
        code: 'relief-materialization-failed',
        message:
          `Relief "${error.source}" could not be compiled from its stored source data. ` +
          `${error.reason} Re-import or replace that relief before preparing G-code.`,
      },
    ],
  };
}
