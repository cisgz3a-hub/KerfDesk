// The Multi-File Trace notice: what was written, what was skipped and why,
// and which files fell back to the default DPI.

import { batchTraceFormatLabel, type BatchTraceSkip } from '../../core/trace/batch-trace';
import { DEFAULT_DPI } from '../common/image-import';
import type { ToastVariant } from '../state/toast-store';
import { traceNoticeMessage, type TraceNotice } from '../trace/trace-notices';
import type { MultiFileTraceExport } from './multi-file-trace-action';

export type PushToast = (message: string, variant?: ToastVariant) => void;

/** What the batch has written so far. */
export type WriteTally = {
  written: number;
  defaultDensity: number;
  readonly notices: Set<TraceNotice>;
  format: MultiFileTraceExport['format'] | null;
  /** Written files whose artwork runs past the chosen paper's edge. */
  readonly pastPage: string[];
  /** Written multi-page TIFFs, of which only page 1 was traced. */
  readonly firstPageOnly: string[];
};

export function emptyWriteTally(): WriteTally {
  return {
    written: 0,
    defaultDensity: 0,
    notices: new Set(),
    format: null,
    pastPage: [],
    firstPageOnly: [],
  };
}

export function writtenSoFar(written: number, total: number): string {
  return `${written} of ${total} ${total === 1 ? 'image was' : 'images were'} written.`;
}

export function reportTraceBatch(
  skipped: ReadonlyArray<BatchTraceSkip>,
  tally: WriteTally,
  pushToast: PushToast,
  settingsLabel?: string,
): void {
  const skippedText = skippedMessage(skipped);
  if (tally.written === 0) {
    if (skippedText !== '') pushToast(skippedText, onlyFailures(skipped) ? 'error' : 'warning');
    return;
  }
  const count = tally.written;
  const format = batchTraceFormatLabel(tally.format ?? 'svg');
  const using = settingsLabel === undefined ? '' : ` with ${settingsLabel}`;
  const summary = `Traced ${count} ${count === 1 ? 'image' : 'images'} to ${format}${using}.`;
  const density = defaultDensityNotice(tally.defaultDensity, count);
  pushToast(
    joinToastParts([
      summary,
      density,
      skippedText,
      pageNotice(tally),
      ...[...tally.notices].map(traceNoticeMessage),
    ]),
    skippedText === '' && tally.pastPage.length === 0 ? 'success' : 'warning',
  );
}

export function joinToastParts(parts: ReadonlyArray<string | null>): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(' ');
}

function skippedMessage(skipped: ReadonlyArray<BatchTraceSkip>): string {
  const blank = skipped.filter((skip) => skip.reason === 'no-visible-paths');
  const parts = [
    blank.length === 0
      ? ''
      : `Skipped ${imageCount(blank.length)} with no visible paths` +
        ` (${blank.map((skip) => skip.sourceName).join(', ')}); try Trace Image with an adjusted threshold or import as Image instead.`,
    failedMessage('Could not read', skipped, 'decode-failed'),
    failedMessage('Could not trace', skipped, 'trace-failed'),
  ];
  return joinToastParts(parts);
}

// One unreadable or untraceable file is skipped with its own reason, so the
// rest of the batch is still written (rank 19).
function failedMessage(
  verb: string,
  skipped: ReadonlyArray<BatchTraceSkip>,
  reason: BatchTraceSkip['reason'],
): string {
  const failed = skipped.filter((skip) => skip.reason === reason);
  if (failed.length === 0) return '';
  const detail = failed
    .map((skip) =>
      skip.message === undefined ? skip.sourceName : `${skip.sourceName}: ${skip.message}`,
    )
    .join('; ');
  return `${verb} ${imageCount(failed.length)} (${detail}); ${failed.length === 1 ? 'it was' : 'they were'} skipped.`;
}

// Paper pages never shrink to the artwork, and a TIFF batch traces page 1:
// both are said, naming the files, so nothing is lost silently.
function pageNotice(tally: WriteTally): string {
  const past =
    tally.pastPage.length === 0
      ? ''
      : `The artwork runs past the page edge in ${tally.pastPage.join(', ')}; viewers crop it there. Choose a larger page or a smaller size.`;
  const pages =
    tally.firstPageOnly.length === 0
      ? ''
      : `Only page 1 was traced of ${tally.firstPageOnly.join(', ')}.`;
  return joinToastParts([past, pages]);
}

function onlyFailures(skipped: ReadonlyArray<BatchTraceSkip>): boolean {
  return skipped.length > 0 && skipped.every((skip) => skip.reason !== 'no-visible-paths');
}

function imageCount(count: number): string {
  return `${count} ${count === 1 ? 'image' : 'images'}`;
}

// As Import Image's toast says "default 254 DPI — no usable embedded density",
// the batch says which written files were sized at the default, so a file
// that fell back cannot pass for one sized by its own DPI.
function defaultDensityNotice(defaultDensity: number, written: number): string | null {
  if (defaultDensity === 0) return null;
  if (written === 1) return `It had no embedded DPI, so it was sized at ${DEFAULT_DPI} DPI.`;
  const was = defaultDensity === 1 ? 'was' : 'were';
  return `${defaultDensity} of ${written} images had no embedded DPI and ${was} sized at ${DEFAULT_DPI} DPI.`;
}
