import type { Project } from '../../core/scene';
import { emitGcodeSnapshot, type EmitGcodeOptions, type EmitGcodeResult } from '../../io/gcode';
import { trustedMotionOffsetForPreflight, type ResolvedJobPlacement } from '../job-placement';
import {
  outputPreparationShouldRunOffThread,
  prepareSaveOutputOffThread,
} from '../laser/output-preparation-worker-client';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';
import { renderVariableText } from '../text/render-variable-text';
import { buildGcodeMetadata } from './build-info';
import type { SaveGcodeCtx } from './file-actions';

export async function emitSaveGcode(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): Promise<EmitGcodeResult> {
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
  return emitGcodeSnapshot(ctx.project, {
    clock: () => new Date(),
    renderVariableText,
    ...(registration === undefined ? {} : { registration }),
    ...options,
  });
}

function hasVariableText(project: Project): boolean {
  return project.scene.objects.some(
    (object) => object.kind === 'text' && object.variableTemplate !== undefined,
  );
}
