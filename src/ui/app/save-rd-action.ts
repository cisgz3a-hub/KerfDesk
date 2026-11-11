// Save-.rd flow for Ruida profiles (ADR-097). Mirrors handleSaveGcode's
// shape: resolve placement upstream, emit through the shared pipeline, pick a
// target, write bytes. The exported file is EXPERIMENTAL - the toast repeats
// the not-hardware-verified warning every time so it cannot be missed.

import type { Project } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { withTextGlyphCheck } from '../../io/gcode/prepare-output-snapshot';
import { rdPreparationOptions, type EmitRdOptions, type EmitRdResult } from '../../io/rd';
import { emitPreparedRdWithJobWarnings } from '../laser/rd-job-warnings';
import type { SaveTarget } from '../../platform/types';
import type { ResolvedJobPlacement } from '../job-placement';
import {
  BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE,
  outputPreparationShouldRunOffThread,
  prepareRdOutputOffThread,
} from '../laser/output-preparation-worker-client';
import {
  isOutputPreparationAbort,
  outputPreparationFailure,
} from '../laser/output-preparation-errors';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { SaveGcodeCtx } from './file-actions';
import { advanceExportVariables } from './advance-export-variables';
import { pickPreparedSaveTarget } from './pick-prepared-save-target';
import { savePreflightFrameOptions } from './save-gcode-emission';
import { captureProjectOutputSnapshot } from '../laser/project-output-snapshot';
import { outputTextRenderer } from '../text/output-text-renderer';
import type { OutputSnapshotRequest } from '../laser/output-preparation-protocol';
import { errorMessage } from '../../core/util/error-message';

const RD_EXPERIMENTAL_WARNING =
  'EXPERIMENTAL .rd export: the encoding follows public Ruida research and has NOT been verified on a real controller. Preview the file on the machine panel and test on scrap first.';

export async function handleSaveRd(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): Promise<void> {
  const snapshot = captureProjectOutputSnapshot(ctx.project);
  const options: EmitRdOptions = {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
    // The frame Save G-code checks in, so a .rd export warns exactly as a
    // G-code save of the same placement would (audit RU-7).
    ...savePreflightFrameOptions(ctx, placement),
  };
  // The picker empties an existing file as it returns (ADR-656), so the job
  // compiles first; a compile that outlasts the click asks for a fresh one. A
  // worker failure is never retried on the browser thread.
  const result =
    snapshot === undefined && !outputPreparationShouldRunOffThread(ctx.project, ctx.outputScope)
      ? await emitRdChecked(ctx.project, options)
      : await prepareBackgroundRd(ctx, options, snapshot);
  if (result === null) return;
  if (!result.ok) return showRdFailure(result.messages);
  const target = await pickRdTarget(ctx);
  if (target !== null) await writeRdResult(ctx, target, result);
}

// The direct compile names each burned text's missing characters, as the worker's compile does
// (ADR-591 Amendment 2).
async function emitRdChecked(project: Project, options: EmitRdOptions): Promise<EmitRdResult> {
  const prepared = prepareOutput(project, rdPreparationOptions(options));
  return emitPreparedRdWithJobWarnings(
    await withTextGlyphCheck(prepared, project, outputTextRenderer),
    options,
  );
}

async function pickRdTarget(ctx: SaveGcodeCtx): Promise<SaveTarget | null> {
  try {
    return await pickPreparedSaveTarget(
      ctx.platform,
      { suggestedName: suggestedRdName(ctx.savedName), extensions: ['.rd'] },
      { title: 'Save .rd file', message: 'The .rd job is ready.' },
    );
  } catch (err) {
    ctx.pushToast(`Could not save .rd file: ${errorMessage(err)}`, 'error');
    return null;
  }
}

async function prepareBackgroundRd(
  ctx: SaveGcodeCtx,
  options: EmitRdOptions,
  snapshot: OutputSnapshotRequest | undefined,
): Promise<EmitRdResult | null> {
  const pending = prepareRdOutputOffThread({
    kind: 'rd',
    project: ctx.project,
    options,
    ...(snapshot === undefined ? {} : { snapshot }),
  });
  if (pending === null) {
    showBackgroundUnavailable();
    return null;
  }
  try {
    return await pending;
  } catch (error) {
    if (isOutputPreparationAbort(error)) throw error;
    showRdFailure([outputPreparationFailure(error).message]);
    return null;
  }
}

async function writeRdResult(
  ctx: SaveGcodeCtx,
  target: SaveTarget,
  result: Extract<EmitRdResult, { readonly ok: true }>,
): Promise<void> {
  try {
    // Copy the Uint8Array view into an exact-size plain ArrayBuffer-backed view
    // so Blob cannot accidentally include bytes outside a future subarray.
    await target.write(new Blob([new Uint8Array(result.bytes)]));
    advanceExportVariables(ctx);
    ctx.pushToast(`Saved .rd job to ${target.displayName}`, 'success');
    for (const advisory of result.advisories) {
      ctx.pushToast(advisory.message, 'warning');
    }
    for (const warning of result.jobWarnings ?? []) ctx.pushToast(warning, 'warning');
    ctx.pushToast(RD_EXPERIMENTAL_WARNING, 'warning');
  } catch (err) {
    ctx.pushToast(`Could not save .rd file: ${errorMessage(err)}`, 'error');
  }
}

function showBackgroundUnavailable(): void {
  showRdFailure([BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE]);
}

function showRdFailure(messages: ReadonlyArray<string>): void {
  const lines = messages.map((message) => `• ${message}`).join('\n');
  jobAwareAlert(`Cannot save .rd file:\n\n${lines}`);
}

function suggestedRdName(savedName: string | null): string {
  const base = savedName === null ? 'job' : savedName.replace(/\.lf2$/i, '');
  return `${base}.rd`;
}
