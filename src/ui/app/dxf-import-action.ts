// importDxfFiles — DXF → imported vector object (Phase H.6a, F-CNC9).
// Machine-agnostic: DXF vectors import in BOTH laser and CNC modes (unlike
// STL reliefs). The parser emits the same SceneObject variant as SVG, so
// re-importing a DXF with the same filename gets the layer-preserving
// replace flow for free.

import type { SceneObject } from '../../core/scene';
import { parseDxf } from '../../io/dxf';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { confirmOversizeImport } from './import-size-guard';
import { describeReimportOutcome } from './import-toasts';

// Minimal file shape shared by DataTransfer Files and the platform
// pickFilesForOpen handles.
type TextFileHandle = {
  readonly name: string;
  readonly size?: number; // byte size when the adapter supplies it (IMP-07)
  readonly text: () => Promise<string>;
};

export function isDxfFile(file: { readonly name: string }): boolean {
  return file.name.toLowerCase().endsWith('.dxf');
}

export async function importDxfFiles(
  files: ReadonlyArray<TextFileHandle>,
  ctx: {
    readonly importObject: (obj: SceneObject, batchIdx?: number) => ImportOutcome;
    readonly pushToast: (message: string, variant?: ToastVariant) => void;
  },
): Promise<void> {
  let successIdx = 0;
  for (const file of files) {
    try {
      // Gate on the file size before reading when the adapter supplies it, so a
      // huge file can't OOM the tab first; fall back to the post-read length gate.
      if (file.size !== undefined && !confirmOversizeImport(file.name, file.size)) continue;
      const text = await file.text();
      if (file.size === undefined && !confirmOversizeImport(file.name, text.length)) continue;
      const result = parseDxf({ dxfText: text, id: crypto.randomUUID(), source: file.name });
      if (result.kind === 'error') {
        ctx.pushToast(`${file.name}: ${result.reason}`, 'error');
        continue;
      }
      if (result.object === null) {
        ctx.pushToast(emptyImportMessage(file.name, result.skippedSummary), 'warning');
        continue;
      }
      const outcome = ctx.importObject(result.object, successIdx);
      successIdx += 1;
      if (outcome.kind === 'replaced') {
        const toast = describeReimportOutcome(outcome);
        ctx.pushToast(toast.message, toast.variant);
        continue;
      }
      ctx.pushToast(successMessage(file.name, result.pathCount, result.skippedSummary), 'success');
    } catch (err) {
      ctx.pushToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
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
