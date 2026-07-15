import type { RunId } from './execution-artifact';
import type { RecoveryStorageBackend } from './recovery-backend';
import { validRecoverySlots } from './recovery-model';
import { releaseRecoveryClaimMutation } from './recovery-slot-mutations';

type CompensationResult = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

/** Removes only the caller's attempt after an ambiguous claim result. The
 * backend transaction itself is the authority: false means that exact attempt
 * was not present, while true means it was durably released. */
export async function compensateFailedRecoveryClaim(args: {
  readonly backend: RecoveryStorageBackend;
  readonly minimumGeneration: number;
  readonly runId: RunId;
  readonly attemptId: string;
  readonly updatedAtIso: string;
}): Promise<CompensationResult> {
  let lastError: unknown = new Error('Recovery claim compensation failed.');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await args.backend.mutateSlots((raw) =>
        releaseRecoveryClaimMutation(
          validRecoverySlots(raw, args.minimumGeneration),
          args.runId,
          args.attemptId,
          args.updatedAtIso,
        ),
      );
      return { ok: true };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, error: lastError };
}
