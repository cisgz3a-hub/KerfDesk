import type { PreflightIssue } from '../../core/preflight';
import type { ResolvedJobPlacement } from '../job-placement';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { SaveGcodeCtx } from './file-actions';
import { emitSaveGcode } from './save-gcode-emission';
import { partitionSavePreflight } from './save-preflight-policy';

export type PreparedGcodeSave =
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly gcode: string;
      readonly advisories: ReadonlyArray<PreflightIssue>;
    };

export async function prepareGcodeSave(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): Promise<PreparedGcodeSave> {
  const emission = await emitSaveGcode(ctx, placement);
  // Preserve the preparation boundary instead of guessing from empty text or
  // widening the global preflight-code set: these inputs produced no program.
  if (emission.kind === 'preparation-failed') {
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
