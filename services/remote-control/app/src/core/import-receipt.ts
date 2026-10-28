/**
 * What an import receipt says beyond "added" (ADR-125 Amendments 2 and 3): the notices the PC
 * showed, and the bed fit when oversize art was scaled down. A phone operator is away from the PC,
 * so the Import sheet shows them instead of a plain "Imported.".
 */
export type ImportNotice = {
  readonly level: 'info' | 'success' | 'warning' | 'error';
  readonly message: string;
};
export type ImportBedFit = {
  readonly scale: number;
  readonly fileWidthMm: number;
  readonly fileHeightMm: number;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
};
export type ImportReceipt = {
  /** The revision the import produced; Undo of its fit is sent against it. */
  readonly revision: string | null;
  /** Errors and warnings first, then the rest, each group in the PC's order. */
  readonly notices: readonly ImportNotice[];
  readonly bedFit: ImportBedFit | null;
};

const LEVELS = ['error', 'warning', 'info', 'success'] as const;

export function readImportReceipt(result: Record<string, unknown>): ImportReceipt {
  return {
    revision: typeof result.revision === 'string' ? result.revision : null,
    notices: readReceiptNotices(result),
    bedFit: isBedFit(result.bedFit) ? result.bedFit : null,
  };
}

/**
 * A receipt's notices, errors and warnings first: an import's, or the machine change an Undo or
 * Redo made (ADR-584 Amendment 1). Malformed entries are ignored.
 */
export function readReceiptNotices(result: Record<string, unknown>): readonly ImportNotice[] {
  const notices = (Array.isArray(result.notices) ? result.notices : []).filter(isNotice);
  return LEVELS.flatMap((level) => notices.filter((notice) => notice.level === level));
}

/** A fit or any notice beyond the plain success line keeps the sheet open to be read. */
export function importNeedsReview(receipt: ImportReceipt): boolean {
  return receipt.bedFit !== null || receipt.notices.some((notice) => notice.level !== 'success');
}

/** The toast for an import with nothing to review: the PC's own success line, when it sent one. */
export function importSuccessText(receipt: ImportReceipt): string {
  return receipt.notices.find((notice) => notice.level === 'success')?.message ?? 'Imported.';
}

export function bedFitHeadline(fit: ImportBedFit): string {
  return `Scaled to ${percent(fit.scale)} to fit the bed`;
}

/** Short: the PC's own fit notice, listed below it, gives the sentence. */
export function bedFitDetail(fit: ImportBedFit): string {
  return `File ${size(fit.fileWidthMm, fit.fileHeightMm)}, bed ${size(fit.bedWidthMm, fit.bedHeightMm)}.`;
}

export function bedFitKeepLabel(scale: number): string {
  return `Keep at ${percent(scale)}`;
}

export function fileSizeRestoredText(fit: ImportBedFit): string {
  return (
    `Back at the file size, ${size(fit.fileWidthMm, fit.fileHeightMm)}: ` +
    `larger than the ${size(fit.bedWidthMm, fit.bedHeightMm)} bed.`
  );
}

function size(width: number, height: number): string {
  return `${mm(width)} × ${mm(height)} mm`;
}

// The PC notice's rounding: three significant digits keep a tiny scale readable.
function percent(scale: number): string {
  return `${Number((scale * 100).toPrecision(3))}%`;
}
function mm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function isNotice(value: unknown): value is ImportNotice {
  if (typeof value !== 'object' || value === null) return false;
  const { level, message } = value as Record<string, unknown>;
  return (
    typeof message === 'string' && message !== '' && (LEVELS as readonly unknown[]).includes(level)
  );
}

function isBedFit(value: unknown): value is ImportBedFit {
  if (typeof value !== 'object' || value === null) return false;
  const fit = value as Record<string, unknown>;
  const fields = ['scale', 'fileWidthMm', 'fileHeightMm', 'bedWidthMm', 'bedHeightMm'];
  return (
    fields.every((field) => typeof fit[field] === 'number' && Number.isFinite(fit[field])) &&
    (fit.scale as number) > 0
  );
}
