// Translate a parseSvg result into the WORKFLOW.md F-A3 toast text.
//
// Pure function: takes filename + parse counts, returns the toast lines and
// variant. Caller (handleImportSvg / useImportDragDrop) pushes the toasts.
// Kept here so both file-menu and drag-drop entry points produce identical
// messaging — and so this logic is unit-testable without React.

import type { ParseSvgResult } from '../../io/svg';
import type { ImportOutcome } from '../state/store';

export type ToastDescriptor = {
  readonly message: string;
  readonly variant: 'info' | 'success' | 'warning' | 'error';
};

export function describeImportResult(
  filename: string,
  result: ParseSvgResult,
): ReadonlyArray<ToastDescriptor> {
  const out: ToastDescriptor[] = [];

  const count = importObjectCount(result);
  if (count === 0) {
    out.push({ message: `${filename} has no drawable content`, variant: 'warning' });
    return out;
  }

  const colorCount = result.object?.paths.length ?? 0;
  out.push({
    message: `Imported ${filename} — ${count} object${count === 1 ? '' : 's'}, ${colorCount} color${colorCount === 1 ? '' : 's'}`,
    variant: 'success',
  });

  const strippedNotes = describeStripped(result.stripped);
  if (strippedNotes !== null) {
    out.push({ message: `${filename}: ${strippedNotes}`, variant: 'info' });
  }

  if (result.ignoredTextElements > 0) {
    const n = result.ignoredTextElements;
    out.push({
      message: `${filename}: ${n} text element${n === 1 ? '' : 's'} ignored — convert to paths, or wait for Phase D`,
      variant: 'info',
    });
  }

  if (result.ignoredImageElements > 0) {
    const n = result.ignoredImageElements;
    out.push({
      message: `${filename}: ${n} image${n === 1 ? '' : 's'} ignored — no embedded bitmap data`,
      variant: 'info',
    });
  }

  for (const note of result.notes.filter((note) => note.startsWith('SVG presentation:'))) {
    out.push({ message: `${filename}: ${note}`, variant: 'warning' });
  }

  return out;
}

export function describeImportError(filename: string, err: unknown): ToastDescriptor {
  const reason = err instanceof Error ? err.message : String(err);
  return {
    message: `Could not import ${filename}: ${reason}`,
    variant: 'error',
  };
}

// Phase C re-import toast. Returned when importSvgObject detects an
// existing object with the same source filename and replaces it in
// place. Shows the kept/added/removed color counts so the user knows
// their layer settings carried over.
export function describeReimportOutcome(
  outcome: Extract<ImportOutcome, { kind: 'replaced' }>,
): ToastDescriptor {
  const parts: string[] = [];
  if (outcome.kept > 0) parts.push(`${outcome.kept} kept`);
  if (outcome.added > 0) parts.push(`${outcome.added} new`);
  if (outcome.removed > 0) parts.push(`${outcome.removed} removed`);
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const settings = outcome.kept > 0 ? 'layer settings preserved' : 'new layer settings';
  return {
    message: `Re-imported ${outcome.source} — ${settings}${detail}`,
    variant: 'success',
  };
}

function describeStripped(s: ParseSvgResult['stripped']): string | null {
  const parts: string[] = [];
  if (s.scripts > 0) parts.push(`${s.scripts} script tag${s.scripts === 1 ? '' : 's'}`);
  if (s.foreignObjects > 0) {
    parts.push(`${s.foreignObjects} foreignObject${s.foreignObjects === 1 ? '' : 's'}`);
  }
  if (s.externalLinks > 0) {
    parts.push(`${s.externalLinks} external link${s.externalLinks === 1 ? '' : 's'}`);
  }
  if (s.dataUris > 0) {
    parts.push(`${s.dataUris} data URI${s.dataUris === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return null;
  return `sanitized ${parts.join(', ')}`;
}

function importObjectCount(result: ParseSvgResult): number {
  return result.fragment?.entries.length ?? (result.object === null ? 0 : 1);
}
