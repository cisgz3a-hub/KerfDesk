import type { RecoveryRepositoryError, RecoveryRepositoryResult } from './recovery-model';

export function recoveryOk<T>(value: T): RecoveryRepositoryResult<T> {
  return { ok: true, value };
}

export function recoveryFailure<T>(error: RecoveryRepositoryError): RecoveryRepositoryResult<T> {
  return { ok: false, error };
}

export function recoveryErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
