import type { SceneObject } from '../../core/scene';
import { parseHpgl, type ParseHpglResult } from '../../io/hpgl';
import { importByteSize, resolveImportBlob, type BlobSourceFile } from '../import/import-file-blob';
import { parseHpglOffThread } from '../import/import-worker-client';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { largeImportAdvisory, mainThreadImportFallbackAdvisory } from './import-size-advisory';
import { describeReimportOutcome } from './import-toasts';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';
import { describeImportBedFit } from './import-bed-fit-notice';

type ImportHpglContext = {
  readonly importObject: (object: SceneObject, batchIndex?: number) => ImportOutcome;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly nextSuccessIndex?: () => number;
};

/** Call with document-bound callbacks, as with the other unified artwork imports. */
export async function importHpglFile(file: BlobSourceFile, ctx: ImportHpglContext): Promise<void> {
  try {
    const blob = await resolveImportBlob(file);
    const size = importByteSize(file, blob);
    const advisory = size === null ? null : largeImportAdvisory(file.name, size);
    if (advisory !== null) ctx.pushToast(advisory, 'warning');
    const result = await parseHpglFile(file, blob, ctx.pushToast);
    applyHpglResult(file.name, result, ctx);
  } catch (error) {
    const cancelled = isImportCancellation(error);
    ctx.pushToast(
      cancelled
        ? `${file.name}: import cancelled.`
        : `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      cancelled ? 'warning' : 'error',
    );
  }
}

function applyHpglResult(name: string, result: ParseHpglResult, ctx: ImportHpglContext): void {
  for (const diagnostic of result.diagnostics) {
    ctx.pushToast(`${name}: ${diagnostic.message}`, diagnostic.severity);
  }
  if (result.kind === 'error') {
    if (result.diagnostics.length === 0) ctx.pushToast(`${name}: ${result.reason}`, 'error');
    return;
  }
  if (result.object === null) {
    ctx.pushToast(`${name}: no drawable HPGL geometry found.`, 'warning');
    return;
  }
  const outcome = ctx.importObject(result.object, ctx.nextSuccessIndex?.() ?? 0);
  if (outcome.kind === 'replaced') {
    const toast = describeReimportOutcome(outcome);
    ctx.pushToast(toast.message, toast.variant);
    return;
  }
  ctx.pushToast(
    `Imported ${result.pathCount} path${result.pathCount === 1 ? '' : 's'} from ${name}.`,
    'success',
  );
  const fitNotice = describeImportBedFit(name, outcome);
  if (fitNotice !== null) ctx.pushToast(fitNotice.message, fitNotice.variant);
}

async function parseHpglFile(
  file: BlobSourceFile,
  blob: Blob | null,
  pushToast: ImportHpglContext['pushToast'],
): Promise<ParseHpglResult> {
  const id = crypto.randomUUID();
  const controls = createImportWorkerControls(file.name, pushToast);
  try {
    const pending =
      blob === null ? null : parseHpglOffThread(blob, id, file.name, controls.options);
    if (pending !== null) return await pending;
    if (blob !== null) pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
    const text = await file.text();
    controls.options.signal?.throwIfAborted();
    return parseHpgl({ text, id, source: file.name });
  } finally {
    controls.dispose();
  }
}
