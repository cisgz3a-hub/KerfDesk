// Save-.egv flow for Lihuiyu profiles (ADR-703), the twin of handleSaveRd:
// resolve placement upstream, compile through the shared pipeline, pick a
// target, write bytes. It needs no driver or USB access, so it works on the
// web. The file is EXPERIMENTAL: the toast repeats the simulator-only warning
// every time so it cannot be missed. The compile runs on this thread.

import type { Project } from '../../core/scene';
import { errorMessage } from '../../core/util/error-message';
import { prepareOutput } from '../../io/gcode';
import { withTextGlyphCheck } from '../../io/gcode/prepare-output-snapshot';
import {
  egvPreparationOptions,
  emitPreparedEgvFile,
  type EmitEgvOptions,
  type EmitEgvResult,
} from '../../io/egv';
import type { SaveTarget } from '../../platform/types';
import type { ResolvedJobPlacement } from '../job-placement';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { outputTextRenderer } from '../text/output-text-renderer';
import { advanceExportVariables } from './advance-export-variables';
import type { SaveGcodeCtx } from './file-actions';
import { pickPreparedSaveTarget } from './pick-prepared-save-target';
import { savePreflightFrameOptions } from './save-gcode-emission';

export const EGV_EXPERIMENTAL_WARNING =
  'EXPERIMENTAL .egv export: the LHYMicro-GL encoding follows MeerK40t and is simulator-tested only, NOT qualified on hardware. The file starts where the head stands — Home first for an Absolute job — and should be air-cut on scrap first.';

export async function handleSaveEgv(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): Promise<void> {
  const options: EmitEgvOptions = {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
    ...savePreflightFrameOptions(ctx, placement),
  };
  // The picker empties an existing file as it returns (ADR-656), so the job
  // compiles first.
  let result: EmitEgvResult;
  try {
    result = await emitEgvChecked(ctx.project, options);
  } catch (error) {
    showEgvFailure([errorMessage(error)]);
    return;
  }
  if (!result.ok) return showEgvFailure(result.messages);
  const target = await pickEgvTarget(ctx);
  if (target !== null) await writeEgvResult(ctx, target, result);
}

async function emitEgvChecked(project: Project, options: EmitEgvOptions): Promise<EmitEgvResult> {
  const prepared = prepareOutput(project, egvPreparationOptions(options));
  return emitPreparedEgvFile(
    await withTextGlyphCheck(prepared, project, outputTextRenderer),
    options,
  );
}

async function pickEgvTarget(ctx: SaveGcodeCtx): Promise<SaveTarget | null> {
  try {
    return await pickPreparedSaveTarget(
      ctx.platform,
      { suggestedName: suggestedEgvName(ctx.savedName), extensions: ['.egv'] },
      { title: 'Save .egv file', message: 'The .egv job is ready.' },
    );
  } catch (err) {
    ctx.pushToast(`Could not save .egv file: ${errorMessage(err)}`, 'error');
    return null;
  }
}

async function writeEgvResult(
  ctx: SaveGcodeCtx,
  target: SaveTarget,
  result: Extract<EmitEgvResult, { readonly ok: true }>,
): Promise<void> {
  try {
    await target.write(new Blob([new Uint8Array(result.bytes)]));
    advanceExportVariables(ctx);
    ctx.pushToast(`Saved .egv job to ${target.displayName}`, 'success');
    for (const advisory of result.advisories) ctx.pushToast(advisory.message, 'warning');
    ctx.pushToast(EGV_EXPERIMENTAL_WARNING, 'warning');
  } catch (err) {
    ctx.pushToast(`Could not save .egv file: ${errorMessage(err)}`, 'error');
  }
}

function showEgvFailure(messages: ReadonlyArray<string>): void {
  const lines = messages.map((message) => `• ${message}`).join('\n');
  jobAwareAlert(`Cannot save .egv file:\n\n${lines}`);
}

export function suggestedEgvName(savedName: string | null): string {
  const base = savedName === null ? 'job' : savedName.replace(/\.lf2$/i, '');
  return `${base}.egv`;
}
