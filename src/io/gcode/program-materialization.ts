import type { PreflightResult } from '../../core/preflight';

export const PROGRAM_MATERIALIZATION_FAILED_MESSAGE =
  'The compiled program could not be materialized in this environment. Reduce image resolution, reduce passes, or split the job, then try again.';

/**
 * Engine allocation failures are facts: an attempted compile/emission already
 * failed. Do not broaden this to all RangeErrors, because those can be ordinary
 * programming defects that must remain visible to diagnostics.
 */
export function isProgramMaterializationRangeError(error: unknown): boolean {
  // The depth planner proves an impossible Array length before allocating.
  // Worker bridges retain its exact message but may reconstruct plain Error.
  if (isImpossibleZPassArray(error)) return true;
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

function isImpossibleZPassArray(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const message = (error as { readonly message?: unknown }).message;
  if (typeof message !== 'string') return false;
  const count =
    /^Z-pass count (Infinity|\d+(?:\.\d+)?(?:e\+\d+)?) exceeds the ECMAScript Array length limit\.$/.exec(
      message,
    )?.[1];
  return count !== undefined && Number(count) > 0xffff_ffff;
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
