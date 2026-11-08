// Translate a parseSvg result into the WORKFLOW.md F-A3 toast text.
//
// Pure function: takes filename + parse counts, returns the toast lines and
// variant. Caller (handleImportSvg / useImportDragDrop) pushes the toasts.
// Kept here so both file-menu and drag-drop entry points produce identical
// messaging — and so this logic is unit-testable without React.

import { KNOCKOUT_WHITE, type WhiteKnockout } from '../../core/geometry/white-fill-knockout';
import { SVG_EMPTY_FILE_MESSAGE, type ParseSvgResult } from '../../io/svg/parse-svg';
import type { ImportOutcome } from '../state/store';

export type ToastDescriptor = {
  readonly message: string;
  readonly variant: 'info' | 'success' | 'warning' | 'error';
  readonly details?: ReadonlyArray<string>;
};

export function describeImportResult(
  filename: string,
  result: ParseSvgResult,
  whiteKnockout?: WhiteKnockout,
): ReadonlyArray<ToastDescriptor> {
  const out: ToastDescriptor[] = [];

  const count = importObjectCount(result) - (whiteKnockout?.removedObjects ?? 0);
  if (count === 0) {
    out.push({ message: `${filename} has no drawable content`, variant: 'warning' });
    return out;
  }

  const colorCount = importColorCount(result, whiteKnockout);
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
      message: `${filename}: ${n} text element${n === 1 ? '' : 's'} ignored — convert text to paths in your editor before exporting`,
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

  out.push(...describeSvgPresentationWarnings(filename, result));

  return out;
}

export function describeSvgPresentationWarnings(
  filename: string,
  result: Pick<ParseSvgResult, 'notes'>,
): ReadonlyArray<ToastDescriptor> {
  return result.notes
    .filter((note) => note.startsWith('SVG presentation:') || note.startsWith('SVG size:'))
    .map((note) => ({ message: `${filename}: ${note}`, variant: 'warning' }));
}

export function describeImportError(filename: string, err: unknown): ToastDescriptor {
  const reason = err instanceof Error ? err.message : String(err);
  // The XML parser's words ("1:134: unexpected close tag") give a beginner no
  // next step, so a broken or empty SVG says what to do and keeps the parser's
  // text under the toast's details (UX audit U5-P3-10). The text crosses the
  // import worker as a string, so it is matched here rather than by type.
  if (reason === SVG_EMPTY_FILE_MESSAGE) {
    return { message: `${filename} is empty, so nothing was imported.`, variant: 'error' };
  }
  if (reason.startsWith('SVG parse error:')) {
    return {
      message: `${filename} isn't a complete SVG file (it is damaged or was cut off), so nothing was imported. Export it again from your design program, or save it as plain SVG.`,
      variant: 'error',
      details: [reason],
    };
  }
  return {
    message: `Could not import ${filename}: ${reason}`,
    variant: 'error',
  };
}

// Phase C re-import toast. Returned when importSvgObject detects an
// existing object with the same source filename and replaces it in
// place. Shows the kept/added/removed color counts so the user knows
// their layer settings carried over. A part that is new starts from default
// settings, which changes the burn, so that toast is a warning, not a success
// (rolling audit v10 V7-P2-2).
export function describeReimportOutcome(
  outcome: Extract<ImportOutcome, { kind: 'replaced' }>,
): ToastDescriptor {
  const parts: string[] = [];
  if (outcome.kept > 0) parts.push(`${outcome.kept} kept`);
  if (outcome.added > 0) parts.push(`${outcome.added} new`);
  if (outcome.removed > 0) parts.push(`${outcome.removed} removed`);
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  const settings = outcome.kept > 0 ? 'layer settings preserved' : 'new layer settings';
  const message = `Re-imported ${outcome.source} — ${settings}${detail}`;
  return outcome.added > 0
    ? {
        message: `${message}. New parts start from default settings: check them before you burn.`,
        variant: 'warning',
      }
    : { message, variant: 'success' };
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

// Paths with an explicit fill rule each keep their own entry, so count
// distinct colours rather than paths (rolling v7 L7-P1-1). White shapes left
// unburned are not a colour the operations hold (ADR-686), unless white the
// file paints see-through, shaded or masked still burns (Amendment 1).
function importColorCount(result: ParseSvgResult, whiteKnockout?: WhiteKnockout): number {
  const colors = new Set(result.object?.paths.map((path) => path.color.toLowerCase()));
  if ((whiteKnockout?.whiteShapes ?? 0) > 0 && whiteKnockout?.inkWhites === 0)
    colors.delete(KNOCKOUT_WHITE);
  return colors.size;
}

function importObjectCount(result: ParseSvgResult): number {
  return result.fragment?.entries.length ?? (result.object === null ? 0 : 1);
}
