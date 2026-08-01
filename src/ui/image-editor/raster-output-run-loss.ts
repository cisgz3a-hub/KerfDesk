import type { SelectionMask } from '../../core/image-select';
import type { RasterGroup } from '../../core/job';
import { rasterRunSurvivesDotWidthCorrection } from '../../core/raster-output';

/** Compact prepared-raster mask for exact-power runs removed from output. */
export type RasterOutputLoss = {
  readonly mask: SelectionMask | null;
  readonly pixels: number;
};

/** Controls whether the caller needs a full output-grid repair mask. */
export type RasterOutputRunLossOptions = {
  readonly shouldCaptureMask: boolean;
};

type LossAccumulator = {
  alpha: Uint8Array | null;
  pixels: number;
  readonly shouldCaptureMask: boolean;
};

type RowLossInput = {
  readonly loss: LossAccumulator;
  readonly row: Uint16Array;
  readonly rowIndex: number;
  readonly group: RasterGroup;
  readonly pixelWidthMm: number;
  readonly isReverse: boolean;
};

/**
 * Find positive exact-S raster runs that disappear after dot-width correction.
 *
 * Rows are consumed once in provider order, so streamed error diffusion keeps
 * its forward-only memory bound. Each pixel and exact-power run is visited
 * once; the advisory never materializes the full preview toolpath.
 */
export function rasterOutputRunLoss(
  group: RasterGroup,
  options: RasterOutputRunLossOptions,
): RasterOutputLoss | null {
  const pixelWidthMm = rasterPixelWidthMm(group);
  if (pixelWidthMm === null) return null;
  const loss: LossAccumulator = {
    alpha: null,
    pixels: 0,
    shouldCaptureMask: options.shouldCaptureMask,
  };
  let emittedRowCount = 0;
  for (let sourceY = 0; sourceY < group.pixelHeight; sourceY += 1) {
    const row = rasterSourceRow(group, sourceY);
    if (row === null) return null;
    const rowIndex =
      group.rowProviderOrder === 'descending-y' ? group.pixelHeight - 1 - sourceY : sourceY;
    const isReverse = (group.bidirectional ?? true) && emittedRowCount % 2 === 1;
    const hasActiveRun = appendRemovedRuns({
      loss,
      row,
      rowIndex,
      group,
      pixelWidthMm,
      isReverse,
    });
    if (hasActiveRun) emittedRowCount += 1;
  }
  return {
    mask:
      loss.alpha === null
        ? null
        : { width: group.pixelWidth, height: group.pixelHeight, alpha: loss.alpha },
    pixels: loss.pixels,
  };
}

function appendRemovedRuns(input: RowLossInput): boolean {
  let firstX = 0;
  let s = input.row[0] ?? 0;
  let hasActiveRun = s > 0;
  for (let x = 1; x <= input.row.length; x += 1) {
    const nextS = x < input.row.length ? (input.row[x] ?? 0) : -1;
    if (nextS === s) continue;
    if (s > 0) {
      hasActiveRun = true;
      appendRemovedRun(input, firstX, x);
    }
    firstX = x;
    s = nextS;
  }
  return hasActiveRun;
}

function appendRemovedRun(input: RowLossInput, firstX: number, endX: number): void {
  const leftX = input.group.bounds.minX + firstX * input.pixelWidthMm;
  const rightX = input.group.bounds.minX + endX * input.pixelWidthMm;
  const startX = input.isReverse ? rightX : leftX;
  const endWorldX = input.isReverse ? leftX : rightX;
  if (
    rasterRunSurvivesDotWidthCorrection(
      startX,
      endWorldX,
      input.isReverse,
      input.group.dotWidthCorrectionMm,
    )
  ) {
    return;
  }
  if (input.loss.alpha === null && input.loss.shouldCaptureMask) {
    input.loss.alpha = new Uint8Array(input.group.pixelWidth * input.group.pixelHeight);
  }
  for (let x = firstX; x < endX; x += 1) {
    if (input.loss.alpha !== null) {
      input.loss.alpha[input.rowIndex * input.group.pixelWidth + x] = 255;
    }
    input.loss.pixels += 1;
  }
}

function rasterSourceRow(group: RasterGroup, sourceY: number): Uint16Array | null {
  const row =
    group.rowProvider === undefined
      ? group.sValues.subarray(sourceY * group.pixelWidth, (sourceY + 1) * group.pixelWidth)
      : group.rowProvider(sourceY);
  return row.length === group.pixelWidth ? row : null;
}

function rasterPixelWidthMm(group: RasterGroup): number | null {
  if (group.pixelWidth <= 0 || group.pixelHeight <= 0) return null;
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  return Number.isFinite(pixelWidthMm) && pixelWidthMm > 0 ? pixelWidthMm : null;
}
