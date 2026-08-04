import type { Project } from '../../core/scene';
import { prepareOutputSnapshot, type EmitGcodeOptions } from '../../io/gcode';
import { trustedMotionOffsetForPreflight, type ResolvedJobPlacement } from '../job-placement';
import {
  outputPreparationShouldRunOffThread,
  prepareSaveOutputOffThread,
  BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE,
} from '../laser/output-preparation-worker-client';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { detectMachineJobWarnings } from '../laser/machine-job-warnings';
import {
  emitSavePreparedOutput,
  unavailableSaveOutput,
  type SaveOutputEmission,
} from '../laser/save-output-emission';
import { renderVariableText } from '../text/render-variable-text';
import { buildGcodeMetadata } from './build-info';
import type { SaveGcodeCtx } from './file-actions';
import {
  hydratePagedRasterProject,
  projectHasPagedRasterAssets,
} from '../import/paged-raster-hydration';

/**
 * Builds the ordinary Save output and preserves preparation failure in the
 * returned discriminator. Callers must branch on `kind` before writing.
 */
export async function emitSaveGcode(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
  execution: {
    readonly signal?: AbortSignal;
    readonly onProgress?: Parameters<typeof prepareSaveOutputOffThread>[1];
  } = {},
): Promise<SaveOutputEmission> {
  const registration = currentPrintCutOutputRegistration(ctx.project);
  const options = saveGcodeOptions(ctx, placement);
  const useSnapshot = registration !== undefined || hasVariableText(ctx.project);
  if (useSnapshot || outputPreparationShouldRunOffThread(ctx.project, ctx.outputScope)) {
    return prepareSaveInBackground(ctx, options, registration, useSnapshot, execution);
  }
  return prepareSaveDirect(ctx, options, registration);
}

function saveGcodeOptions(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): EmitGcodeOptions {
  const motionOffset = trustedMotionOffsetForPreflight(ctx.project.device, placement);
  return {
    metadata: buildGcodeMetadata(),
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
    ...(motionOffset === undefined ? {} : { preflightMotionOffset: motionOffset }),
    ...(ctx.allowRotaryRaster === true ? { allowRotaryRaster: true } : {}),
  };
}

async function prepareSaveInBackground(
  ctx: SaveGcodeCtx,
  options: EmitGcodeOptions,
  registration: ReturnType<typeof currentPrintCutOutputRegistration>,
  useSnapshot: boolean,
  execution: {
    readonly signal?: AbortSignal;
    readonly onProgress?: Parameters<typeof prepareSaveOutputOffThread>[1];
  },
): Promise<SaveOutputEmission> {
  const background = prepareSaveOutputOffThread(
    {
      kind: 'save',
      project: ctx.project,
      options,
      ...(ctx.controllerSettings === undefined
        ? {}
        : { controllerSettings: ctx.controllerSettings }),
      ...(ctx.activeWcs === undefined ? {} : { activeWcs: ctx.activeWcs }),
      ...(useSnapshot
        ? {
            snapshot: {
              evaluatedAtIso: new Date().toISOString(),
              ...(registration === undefined ? {} : { registration }),
            },
          }
        : {}),
    },
    execution.onProgress,
    execution.signal,
  );
  if (background === null) {
    return unavailableSaveOutput(BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE);
  }
  try {
    return await background;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    console.warn('Background Save preparation failed.', error);
    return unavailableSaveOutput(BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE);
  }
}

async function prepareSaveDirect(
  ctx: SaveGcodeCtx,
  options: EmitGcodeOptions,
  registration: ReturnType<typeof currentPrintCutOutputRegistration>,
): Promise<SaveOutputEmission> {
  const preparationProject = projectHasPagedRasterAssets(ctx.project)
    ? await hydratePagedRasterProject(ctx.project)
    : ctx.project;
  const prepared = await prepareOutputSnapshot(preparationProject, {
    clock: () => new Date(),
    renderVariableText,
    ...(registration === undefined ? {} : { registration }),
    ...options,
  });
  const machineWarnings = prepared.ok
    ? detectMachineJobWarnings(
        prepared.project,
        ctx.controllerSettings ?? null,
        ctx.activeWcs ?? null,
        prepared,
      )
    : [];
  return emitSavePreparedOutput(prepared, options, machineWarnings);
}

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}
