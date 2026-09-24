// The import notice for art larger than the bed. Artwork keeps its file size;
// only oversize art is scaled down to fit, and the operator must hear about it
// because the burn no longer matches the file. Toasts carry no action button,
// so the notice points at Undo, which restores the original size
// (applyImportBedFit records the scaling as its own undo step).

import type { ImportOutcome } from '../state/store';
import type { ToastDescriptor } from './import-toasts';

export function describeImportBedFit(
  filename: string,
  outcome: ImportOutcome | undefined,
): ToastDescriptor | null {
  if (outcome?.kind !== 'added' || outcome.bedFit === undefined) return null;
  const fit = outcome.bedFit;
  return {
    message:
      `${filename} is larger than the ${formatMm(fit.bedWidthMm)} × ${formatMm(fit.bedHeightMm)} mm bed ` +
      `(${formatMm(fit.widthMm)} × ${formatMm(fit.heightMm)} mm), so it was scaled to ` +
      `${formatPercent(fit.scale)} to fit. Undo restores the original size.`,
    variant: 'warning',
  };
}

// One decimal with a trailing zero trimmed, like the Job Review sizes.
function formatMm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// Three significant digits keep a tiny scale readable instead of showing 0%.
function formatPercent(scale: number): string {
  return `${Number((scale * 100).toPrecision(3))}%`;
}
