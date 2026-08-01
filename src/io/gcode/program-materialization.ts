import type { PreflightResult } from '../../core/preflight';

export const PROGRAM_MATERIALIZATION_FAILED_MESSAGE =
  'The compiled program could not be materialized in this environment. Reduce image resolution, reduce passes, or split the job, then try again.';

/**
 * Engine allocation failures are facts: an attempted compile/emission already
 * failed. Do not broaden this to all RangeErrors, because those can be ordinary
 * programming defects that must remain visible to diagnostics.
 */
export function isProgramMaterializationRangeError(error: unknown): boolean {
  if (!isNamedRangeError(error)) return false;
  const message = error.message;
  return (
    message === 'Invalid string length' ||
    message === 'Array buffer allocation failed' ||
    message === 'Out of memory' ||
    /^Cannot create a string longer than /.test(message) ||
    /^Invalid typed array length: (?:Infinity|NaN|[1-9]\d{7,}|[1-9](?:\.\d+)?e\+\d+)$/i.test(
      message,
    )
  );
}

export function programMaterializationFailure(): PreflightResult {
  return {
    ok: false,
    issues: [
      {
        code: 'program-materialization-failed',
        message: PROGRAM_MATERIALIZATION_FAILED_MESSAGE,
      },
    ],
  };
}

function isNamedRangeError(
  error: unknown,
): error is { readonly name: string; readonly message: string } {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly name?: unknown; readonly message?: unknown };
  return candidate.name === 'RangeError' && typeof candidate.message === 'string';
}
