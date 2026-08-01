import type { PreflightIssue } from '../../core/preflight';
import type { ResolvedJobPlacement } from '../job-placement';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { SaveGcodeCtx } from './file-actions';
import { emitSaveGcode } from './save-gcode-emission';
import { partitionSavePreflight } from './save-preflight-policy';

/**
 * Result of preparing the ordinary Save G-code action. Callers must branch on
 * `kind`; `failed` means no file may be selected or written.
 */
export type PreparedGcodeSave =
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly gcode: string;
      readonly advisories: ReadonlyArray<PreflightIssue>;
    };

/**
 * Prepares G-code for Save while preserving factual preparation failure as a
 * stopped action and returning only successfully emitted text as `ready`.
 */
export async function prepareGcodeSave(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): Promise<PreparedGcodeSave> {
  const emission = await emitSaveGcode(ctx, placement);
  // Preserve both factual no-program boundaries instead of widening the
  // global preflight-code set: neither result contains writable bytes.
  if (emission.kind !== 'emitted') {
    showFailure(emission.preflight.issues);
    return { kind: 'failed' };
  }
  const { blocking, advisories } = partitionSavePreflight(emission.preflight.issues);
  if (blocking.length > 0) {
    showFailure(blocking);
    return { kind: 'failed' };
  }
  return { kind: 'ready', gcode: emission.gcode, advisories };
}

function showFailure(issues: ReadonlyArray<PreflightIssue>): void {
  const lines = issues.map((issue) => `• ${issue.message}`).join('\n');
  jobAwareAlert(`Cannot save G-code:\n\n${lines}`);
}
