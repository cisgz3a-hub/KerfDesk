import { FocusTestCompilationError } from '../../core/job/focus-test-compilation-error';
import type { PreflightResult } from '../../core/preflight';

export function focusTestCompilationFailure(error: unknown): PreflightResult | null {
  return error instanceof FocusTestCompilationError
    ? { ok: false, issues: [{ code: 'focus-test-uncompilable', message: error.message }] }
    : null;
}
