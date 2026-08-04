// Save-.rd flow for Ruida profiles (ADR-097). Mirrors handleSaveGcode's
// shape: resolve placement upstream, emit through the shared pipeline, pick a
// target, write bytes. The exported file is EXPERIMENTAL - the toast repeats
// the not-hardware-verified warning every time so it cannot be missed.

import { emitRdFile, type EmitRdOptions, type EmitRdResult } from '../../io/rd';
import type { SaveTarget } from '../../platform/types';
import type { ResolvedJobPlacement } from '../job-placement';
import {
  BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE,
  outputPreparationShouldRunOffThread,
  prepareRdOutputOffThread,
} from '../laser/output-preparation-worker-client';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { SaveGcodeCtx } from './file-actions';

const RD_EXPERIMENTAL_WARNING =
  'EXPERIMENTAL .rd export: the encoding follows public Ruida research and has NOT been verified on a real controller. Preview the file on the machine panel and test on scrap first.';

export async function handleSaveRd(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): Promise<void> {
  const options: EmitRdOptions = {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
  };
  if (!outputPreparationShouldRunOffThread(ctx.project, ctx.outputScope)) {
    const result = emitRdFile(ctx.project, options);
    if (!result.ok) return showRdFailure(result.messages);
    const target = await pickRdTarget(ctx);
    if (target !== null) await writeRdResult(ctx, target, result);
    return;
  }
  // The picker must consume transient user activation before the costly await.
  // A worker failure leaves a recoverable empty target and never retries the
  // compile on the browser thread.
  const target = await pickRdTarget(ctx);
  if (target === null) return;
  const result = await prepareBackgroundRd(ctx, options);
  if (result === null) return;
  if (!result.ok) return showRdFailure(result.messages);
  await writeRdResult(ctx, target, result);
}

async function pickRdTarget(ctx: SaveGcodeCtx): Promise<SaveTarget | null> {
  try {
    return await ctx.platform.pickFileForSave({
      suggestedName: suggestedRdName(ctx.savedName),
      extensions: ['.rd'],
    });
  } catch (err) {
    ctx.pushToast(`Could not save .rd file: ${errorMessage(err)}`, 'error');
    return null;
  }
}

async function prepareBackgroundRd(
  ctx: SaveGcodeCtx,
  options: EmitRdOptions,
): Promise<EmitRdResult | null> {
  const pending = prepareRdOutputOffThread({ kind: 'rd', project: ctx.project, options });
  if (pending === null) {
    showBackgroundUnavailable();
    return null;
  }
  try {
    return await pending;
  } catch {
    showBackgroundUnavailable();
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
    ctx.pushToast(`Saved .rd job to ${target.displayName}`, 'success');
    for (const advisory of result.advisories) {
      ctx.pushToast(advisory.message, 'warning');
    }
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
