import { selectControllerDriver } from '../../core/controllers';
import type { Project } from '../../core/scene';
import { resolveExportJobPlacement, DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { SaveGcodeCtx } from './file-actions';
import { prepareGcodeSave } from './prepare-gcode-save';

export type PrebuiltGcodeSave = {
  readonly project: Project;
  readonly placement: Extract<ReturnType<typeof resolveExportJobPlacement>, { readonly ok: true }>;
  readonly prepared: Extract<
    Awaited<ReturnType<typeof prepareGcodeSave>>,
    { readonly kind: 'ready' }
  >;
};

export function ordinaryGcodeSaveUsesPrebuiltDialog(project: Project): boolean {
  const tiled = project.machine?.kind === 'cnc' && project.machine.tiling !== undefined;
  const fileOnly =
    selectControllerDriver(project.device.controllerKind).capabilities.transport === 'file-only';
  return !tiled && !fileOnly;
}

/** Build the complete ordinary export before any final path is selected. */
export async function prebuildGcodeSave(ctx: SaveGcodeCtx): Promise<PrebuiltGcodeSave | null> {
  if (!ordinaryGcodeSaveUsesPrebuiltDialog(ctx.project)) return null;
  const placement = saveGcodePlacement(ctx);
  if (placement === null) return null;
  const prepared = await prepareGcodeSave(ctx, placement);
  return prepared.kind === 'ready' ? { project: ctx.project, placement, prepared } : null;
}

export function saveGcodePlacement(
  ctx: SaveGcodeCtx,
): Extract<ReturnType<typeof resolveExportJobPlacement>, { readonly ok: true }> | null {
  const placement = resolveExportJobPlacement(ctx.jobPlacement ?? DEFAULT_JOB_PLACEMENT, {
    statusReport: null,
    workOriginActive: false,
    wcoCache: null,
    ...ctx.machine,
  });
  if (placement.ok) return placement;
  const lines = placement.messages.map((message) => `• ${message}`).join('\n');
  jobAwareAlert(`Cannot save G-code:\n\n${lines}`);
  return null;
}
