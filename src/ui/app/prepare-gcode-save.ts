import type { CncToolProgram } from '../../io/cnc/cnc-tool-programs';
import type { EmittedDesignPlacement } from '../laser/save-output-emission';
import type { CncProgramFacts } from '../../io/cnc/cnc-program-facts';
import type { PreflightIssue } from '../../core/preflight';
import type { CompiledVCarveLayerDepth } from '../laser/cnc-compiled-depth-warnings';
import type { ResolvedJobPlacement } from '../job-placement';
import type { SaveGcodeCtx } from './file-actions';
import { emitSaveGcode } from './save-gcode-emission';
import { partitionSavePreflight } from './save-preflight-policy';

/**
 * Result of preparing the ordinary Save G-code action. Callers must branch on
 * `kind`; `failed` means no file may be selected or written, and `reasons`
 * says why. The caller shows them: this function raises no dialog of its own
 * (annoyance audit A1-P3-9, ADR-656 Amendment 4).
 */
export type PreparedGcodeSave =
  | { readonly kind: 'failed'; readonly reasons: ReadonlyArray<string> }
  | {
      readonly kind: 'ready';
      readonly gcode: string;
      readonly cncProgramFacts?: CncProgramFacts;
      readonly cncToolPrograms?: ReadonlyArray<CncToolProgram>;
      readonly placement?: EmittedDesignPlacement;
      readonly advisories: ReadonlyArray<PreflightIssue>;
      readonly cncVCarveDepths: ReadonlyArray<CompiledVCarveLayerDepth>;
      readonly machineWarnings: ReadonlyArray<string>;
    };

/**
 * Prepares G-code for Save while preserving factual preparation failure as a
 * stopped action and returning only successfully emitted text as `ready`.
 */
export async function prepareGcodeSave(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
  execution: Parameters<typeof emitSaveGcode>[2] = {},
): Promise<PreparedGcodeSave> {
  const emission = await emitSaveGcode(ctx, placement, execution);
  if ('message' in emission) return { kind: 'failed', reasons: [emission.message] };
  // Preserve both factual no-program boundaries instead of widening the
  // global preflight-code set: neither result contains writable bytes.
  if (emission.kind !== 'emitted') return failed(emission.preflight.issues);
  const { blocking, advisories } = partitionSavePreflight(emission.preflight.issues);
  if (blocking.length > 0) return failed(blocking);
  return {
    kind: 'ready',
    gcode: emission.gcode,
    ...(emission.placement === undefined ? {} : { placement: emission.placement }),
    ...(emission.cncProgramFacts === undefined
      ? {}
      : { cncProgramFacts: emission.cncProgramFacts }),
    ...(emission.cncToolPrograms === undefined
      ? {}
      : { cncToolPrograms: emission.cncToolPrograms }),
    advisories,
    cncVCarveDepths: emission.cncVCarveDepths,
    machineWarnings: emission.machineWarnings ?? [],
  };
}

function failed(issues: ReadonlyArray<PreflightIssue>): PreparedGcodeSave {
  return { kind: 'failed', reasons: issues.map((issue) => issue.message) };
}
