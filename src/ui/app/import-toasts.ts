// Translate a parseSvg result into the WORKFLOW.md F-A3 toast text.
//
// Pure function: takes filename + parse counts, returns the toast lines and
// variant. Caller (handleImportSvg / useImportDragDrop) pushes the toasts.
// Kept here so both file-menu and drag-drop entry points produce identical
// messaging — and so this logic is unit-testable without React.

import type { ParseSvgResult } from '../../io/svg';

export type ToastDescriptor = {
  readonly message: string;
  readonly variant: 'info' | 'success' | 'warning' | 'error';
};

export function describeImportResult(
  filename: string,
  result: ParseSvgResult,
): ReadonlyArray<ToastDescriptor> {
  const out: ToastDescriptor[] = [];

  if (result.object === null) {
    out.push({ message: `${filename} has no drawable content`, variant: 'warning' });
    return out;
  }

  const colorCount = result.object.paths.length;
  out.push({
    message: `Imported ${filename} — 1 object, ${colorCount} color${colorCount === 1 ? '' : 's'}`,
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
      message: `${filename}: ${n} embedded image${n === 1 ? '' : 's'} ignored — Phase E will support these`,
      variant: 'info',
    });
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
