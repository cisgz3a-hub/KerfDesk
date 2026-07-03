// Save-.rd flow for Ruida profiles (ADR-097). Mirrors handleSaveGcode's
// shape: resolve placement upstream, emit through the shared pipeline, pick a
// target, write bytes. The exported file is EXPERIMENTAL — the toast repeats
// the not-hardware-verified warning every time so it cannot be missed.

import { emitRdFile } from '../../io/rd';
import type { ResolvedJobPlacement } from '../job-placement';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { SaveGcodeCtx } from './file-actions';

const RD_EXPERIMENTAL_WARNING =
  'EXPERIMENTAL .rd export: the encoding follows public Ruida research and has NOT been verified on a real controller. Preview the file on the machine panel and test on scrap first.';

export async function handleSaveRd(
  ctx: SaveGcodeCtx,
  placement: Extract<ResolvedJobPlacement, { readonly ok: true }>,
): Promise<void> {
  const result = emitRdFile(ctx.project, {
    ...(placement.jobOrigin === undefined ? {} : { jobOrigin: placement.jobOrigin }),
    ...(ctx.outputScope === undefined ? {} : { outputScope: ctx.outputScope }),
  });
  if (!result.ok) {
    const lines = result.messages.map((message) => `• ${message}`).join('\n');
    jobAwareAlert(`Cannot save .rd file:\n\n${lines}`);
    return;
  }
  let target;
  try {
    target = await ctx.platform.pickFileForSave({
      suggestedName: suggestedRdName(ctx.savedName),
      extensions: ['.rd'],
    });
  } catch (err) {
    ctx.pushToast(`Could not save .rd file: ${errorMessage(err)}`, 'error');
    return;
  }
  if (target === null) return;
  try {
    // Uint8Array → Blob: SaveTarget.write accepts string | Blob; a Blob keeps
    // the byte stream intact (no UTF-8 mangling).
    await target.write(new Blob([result.bytes.buffer as ArrayBuffer]));
    ctx.pushToast(`Saved .rd job to ${target.displayName}`, 'success');
    ctx.pushToast(RD_EXPERIMENTAL_WARNING, 'warning');
  } catch (err) {
    ctx.pushToast(`Could not save .rd file: ${errorMessage(err)}`, 'error');
  }
}

function suggestedRdName(savedName: string | null): string {
  const base = savedName === null ? 'job' : savedName.replace(/\.lf2$/i, '');
  return `${base}.rd`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
