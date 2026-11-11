import { selectControllerDriver } from '../../core/controllers';
import type { Project } from '../../core/scene';
import { resolveExportJobPlacement, DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { GCODE_SAVE_REFUSED, pushExportRefusal } from './export-refusal';
import type { SaveGcodeCtx } from './file-actions';
import { prepareGcodeSave } from './prepare-gcode-save';

type ExportPlacement = Extract<ReturnType<typeof resolveExportJobPlacement>, { readonly ok: true }>;

export type PrebuiltGcodeSave = {
  readonly project: Project;
  readonly placement: ExportPlacement;
  readonly prepared: Extract<
    Awaited<ReturnType<typeof prepareGcodeSave>>,
    { readonly kind: 'ready' }
  >;
};

/** The ordinary export, complete, or the reasons there is none to save. */
export type GcodeSavePrebuild =
  | { readonly kind: 'ready'; readonly artifact: PrebuiltGcodeSave }
  | { readonly kind: 'refused'; readonly reasons: ReadonlyArray<string> }
  /** A tiled or controller-specific save, which prepares inside its own flow. */
  | { readonly kind: 'not-ordinary' };

export function ordinaryGcodeSaveUsesPrebuiltDialog(project: Project): boolean {
  const tiled = project.machine?.kind === 'cnc' && project.machine.tiling !== undefined;
  const fileOnly =
    selectControllerDriver(project.device.controllerKind).capabilities.transport === 'file-only';
  return !tiled && !fileOnly;
}

/** A CNC export also offers the setup sheet package, so its dialog is a real
 * choice and is always shown (ADR-392, ADR-656 Amendment 4). */
export function prebuiltSaveOffersSetupSheet(artifact: PrebuiltGcodeSave): boolean {
  return (
    artifact.prepared.cncProgramFacts !== undefined && artifact.project.machine?.kind === 'cnc'
  );
}

/**
 * Build the complete ordinary export before any final path is selected, and
 * hand back the reasons when there is none. Shows nothing itself: the caller
 * decides between the save dialog and a toast (ADR-656 Amendment 4).
 */
export async function prebuildGcodeSaveResult(
  ctx: SaveGcodeCtx,
  execution: Parameters<typeof prepareGcodeSave>[2] = {},
): Promise<GcodeSavePrebuild> {
  if (!ordinaryGcodeSaveUsesPrebuiltDialog(ctx.project)) return { kind: 'not-ordinary' };
  const placement = resolveSaveGcodePlacement(ctx);
  if (!placement.ok) return { kind: 'refused', reasons: placement.messages };
  const prepared = await prepareGcodeSave(ctx, placement, execution);
  if (prepared.kind === 'failed') return { kind: 'refused', reasons: prepared.reasons };
  return { kind: 'ready', artifact: { project: ctx.project, placement, prepared } };
}

/** As `prebuildGcodeSaveResult`, reporting a refusal as one error toast. */
export async function prebuildGcodeSave(ctx: SaveGcodeCtx): Promise<PrebuiltGcodeSave | null> {
  const result = await prebuildGcodeSaveResult(ctx);
  if (result.kind === 'ready') return result.artifact;
  if (result.kind === 'refused')
    pushExportRefusal(ctx.pushToast, GCODE_SAVE_REFUSED, result.reasons);
  return null;
}

function resolveSaveGcodePlacement(
  ctx: SaveGcodeCtx,
): ReturnType<typeof resolveExportJobPlacement> {
  return resolveExportJobPlacement(ctx.jobPlacement ?? DEFAULT_JOB_PLACEMENT, {
    statusReport: null,
    workOriginActive: false,
    wcoCache: null,
    ...ctx.machine,
  });
}

export function saveGcodePlacement(ctx: SaveGcodeCtx): ExportPlacement | null {
  const placement = resolveSaveGcodePlacement(ctx);
  if (placement.ok) return placement;
  pushExportRefusal(ctx.pushToast, GCODE_SAVE_REFUSED, placement.messages);
  return null;
}
