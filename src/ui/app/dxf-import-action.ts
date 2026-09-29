// importDxfFiles — DXF → imported vector object (Phase H.6a, F-CNC9).
// Machine-agnostic: DXF vectors import in BOTH laser and CNC modes (unlike
// STL reliefs). The parser emits the same SceneObject variant as SVG, so
// re-importing a DXF with the same filename gets the layer-preserving
// replace flow for free.

import type { SceneObject } from '../../core/scene';
import { parseDxf, type ParseDxfResult } from '../../io/dxf';
import { importByteSize, resolveImportBlob } from '../import/import-file-blob';
import { parseDxfOffThread, type ImportWorkerRequestOptions } from '../import/import-worker-client';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { largeImportAdvisory, mainThreadImportFallbackAdvisory } from './import-size-advisory';
import { describeImportBedFit } from './import-bed-fit-notice';
import { describeReimportOutcome } from './import-toasts';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';
import { claimImportSuccessIndex } from './import-success-index';

// Minimal file shape shared by DataTransfer Files and the platform
// pickFilesForOpen handles.
type TextFileHandle = {
  readonly name: string;
  readonly size?: number; // byte size when the adapter supplies it (IMP-07)
  readonly text: () => Promise<string>;
  readonly blob?: () => Promise<Blob>;
};

export function isDxfFile(file: { readonly name: string }): boolean {
  return file.name.toLowerCase().endsWith('.dxf');
}

export async function importDxfFiles(
  files: ReadonlyArray<TextFileHandle>,
  ctx: {
    readonly importObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome;
    readonly pushToast: (message: string, variant?: ToastVariant) => void;
    readonly nextSuccessIndex?: () => number;
  },
): Promise<void> {
  let successIdx = 0;
  for (const file of files) {
    try {
      // Advise on size before any read, so the operator learns the cost up front.
      const blob = await resolveImportBlob(file);
      const sizeBytes = importByteSize(file, blob);
      const advisory = sizeBytes === null ? null : largeImportAdvisory(file.name, sizeBytes);
      if (advisory !== null) ctx.pushToast(advisory, 'warning');
      const result = await parseDxfFile(file, blob, ctx.pushToast);
      if (result.kind === 'error') {
        ctx.pushToast(`${file.name}: ${result.reason}`, 'error');
        continue;
      }
      if (result.object === null) {
        ctx.pushToast(emptyImportMessage(file.name, result.skippedSummary), 'warning');
        pushNoteToasts(file.name, result.notes, ctx.pushToast);
        continue;
      }
      const claimed = claimImportSuccessIndex(ctx.nextSuccessIndex, successIdx);
      successIdx = claimed.nextLocalIndex;
      const outcome = ctx.importObject(result.object, claimed.batchIndex);
      reportDxfImport(file.name, result, outcome, ctx.pushToast);
    } catch (err) {
      ctx.pushToast(
        isImportCancellation(err)
          ? `${file.name}: import cancelled.`
          : `${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        isImportCancellation(err) ? 'warning' : 'error',
      );
    }
  }
}

// Parse in the import worker when a Blob is reachable — the worker reads the
// file itself, so a 100 MB DXF never becomes a main-thread string (measured:
// ~11.4 s of blocked UI at that size). Text-only adapters and mocks keep their
// compatibility path. If Worker construction itself is unavailable, the same
// valid parser remains available on the UI thread with an explicit responsiveness
// warning; a started, failed, or cancelled worker request never enters that fallback.
async function parseDxfFile(
  file: TextFileHandle,
  blob: Blob | null,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<ParseDxfResult> {
  const id = crypto.randomUUID();
  const controls = createImportWorkerControls(file.name, pushToast);
  try {
    const offThread = parseDxfInWorker(blob, id, file.name, controls.options);
    if (offThread !== null) return await offThread;
    if (blob !== null) {
      pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
      return parseDxf({ dxfText: await file.text(), id, source: file.name });
    }
    return parseDxf({ dxfText: await file.text(), id, source: file.name });
  } finally {
    controls.dispose();
  }
}

function parseDxfInWorker(
  blob: Blob | null,
  id: string,
  name: string,
  options: ImportWorkerRequestOptions,
): Promise<ParseDxfResult> | null {
  return blob === null ? null : parseDxfOffThread(blob, id, name, options);
}

function reportDxfImport(
  name: string,
  result: Extract<ParseDxfResult, { kind: 'ok' }>,
  outcome: ImportOutcome,
  pushToast: (message: string, variant?: ToastVariant) => void,
): void {
  if (outcome.kind === 'replaced') {
    const toast = describeReimportOutcome(outcome);
    pushToast(toast.message, toast.variant);
  } else {
    pushToast(successMessage(name, result.pathCount, result.skippedSummary), 'success');
  }
  // A re-import loses the same parts, so its notes are shown too.
  pushNoteToasts(name, result.notes, pushToast);
  // Last, so the three-toast stack cannot push it out of view.
  const fitNotice = describeImportBedFit(name, outcome);
  if (fitNotice !== null) pushToast(fitNotice.message, fitNotice.variant);
}

// Parser notes name parts the import dropped or guessed at: an unknown block,
// an unrecognized $INSUNITS, nesting past the depth cap, a tilted entity.
// Each gets its own warning toast, as SVG import notes do; past the cap one
// toast counts the rest so they cannot bury the other toasts.
const MAX_NOTE_TOASTS = 3;

function pushNoteToasts(
  name: string,
  notes: ReadonlyArray<string>,
  pushToast: (message: string, variant?: ToastVariant) => void,
): void {
  const overflows = notes.length > MAX_NOTE_TOASTS;
  const shown = overflows ? notes.slice(0, MAX_NOTE_TOASTS - 1) : notes;
  for (const note of shown) pushToast(`${name}: ${note}`, 'warning');
  if (overflows) {
    pushToast(`${name}: ${notes.length - shown.length} more import warnings.`, 'warning');
  }
}

function successMessage(name: string, pathCount: number, skippedSummary: string | null): string {
  const paths = `${pathCount} path${pathCount === 1 ? '' : 's'}`;
  return skippedSummary === null
    ? `Imported ${paths} from ${name}.`
    : `Imported ${paths} from ${name} — skipped ${skippedSummary}.`;
}

function emptyImportMessage(name: string, skippedSummary: string | null): string {
  return skippedSummary === null
    ? `${name}: no supported geometry found.`
    : `${name}: no supported geometry — skipped ${skippedSummary}.`;
}
