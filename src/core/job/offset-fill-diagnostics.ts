import { assertNever } from '../scene';
import type { JobDiagnostic } from './job';
import type { OffsetFillTermination } from './offset-fill';

const NO_DIAGNOSTICS: ReadonlyArray<JobDiagnostic> = [];

/** Convert Follow Shape termination into non-blocking compile diagnostics. */
export function offsetFillDiagnostics(
  termination: OffsetFillTermination,
  layerName: string,
): ReadonlyArray<JobDiagnostic> {
  switch (termination.kind) {
    case 'complete':
      return NO_DIAGNOSTICS;
    case 'offset-failed':
      return [{ kind: 'offset-fill-failed', layerName }];
    case 'pass-limit':
      return [{ kind: 'offset-fill-pass-limit', layerName, passLimit: termination.passLimit }];
    default:
      return assertNever(termination, 'OffsetFillTermination');
  }
}
