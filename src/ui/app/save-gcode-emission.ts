import type { Project } from '../../core/scene';
import { prepareOutputSnapshot, type EmitGcodeOptions } from '../../io/gcode';
import { trustedMotionOffsetForPreflight, type ResolvedJobPlacement } from '../job-placement';
import {
  outputPreparationShouldRunOffThread,
  prepareSaveOutputOffThread,
} from '../laser/output-preparation-worker-client';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { emitSavePreparedOutput, type SaveOutputEmission } from '../laser/save-output-emission';
import { renderVariableText } from '../text/render-variable-text';
import { buildGcodeMetadata } from './build-info';
import type { SaveGcodeCtx } from './file-actions';

/**
 * Builds the ordinary Save output and preserves preparation failure in the
 * returned discriminator. Callers must branch on `kind` before writing.
 */
export async function emitSaveGcode(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): Promise<SaveOutputEmission> {
  const motionOffset = trustedMotionOffsetForPreflight(ctx.project.device, placement);
  const registration = currentPrintCutOutputRegistration(ctx.project);
  const options: EmitGcodeOptions = {
    metadata: buildGcodeMetadata(),
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
    ...(motionOffset === undefined ? {} : { preflightMotionOffset: motionOffset }),
    ...(ctx.allowRotaryRaster === true ? { allowRotaryRaster: true } : {}),
  };
  if (
    registration === undefined &&
    !hasVariableText(ctx.project) &&
    outputPreparationShouldRunOffThread(ctx.project, ctx.outputScope)
  ) {
    const background = prepareSaveOutputOffThread({ kind: 'save', project: ctx.project, options });
    if (background !== null) {
      try {
        return await background;
      } catch (error) {
        console.warn('Background Save preparation failed; retrying on the main thread.', error);
      }
    }
  }
  const prepared = await prepareOutputSnapshot(ctx.project, {
    clock: () => new Date(),
    renderVariableText,
    ...(registration === undefined ? {} : { registration }),
    ...options,
  });
  return emitSavePreparedOutput(prepared, options);
}

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}
