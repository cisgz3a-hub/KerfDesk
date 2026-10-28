import type { SelectionMask } from '../../core/image-select';
import type { RasterPowerValues } from '../../core/raster/raster-power-values';
import { forEachRasterRunLostToDotWidthCorrection } from '../../core/raster-output';

type HorizontalMaskRepairInput = {
  readonly seed: SelectionMask;
  readonly radiusPx: number;
  readonly minXWorldMm: number;
  readonly pixelWidthMm: number;
  readonly dotWidthCorrectionMm: number;
  readonly sourceSValues: RasterPowerValues;
  readonly filledS: number;
  readonly outputMaskFor: (sourceMask: SelectionMask) => SelectionMask;
};

/**
 * Expand a repair only along scan rows, then retain it only when every final
 * powered run keeps a burn under the emitter's strict forward and reverse
 * correction operands, which shorten the ends of each burned line.
 */
export function editorHorizontalMaskRepair(input: HorizontalMaskRepairInput): SelectionMask | null {
  const radiusPx = Math.floor(input.radiusPx);
  if (
    radiusPx < 1 ||
    input.seed.width < 1 ||
    input.seed.height < 1 ||
    input.seed.alpha.length !== input.seed.width * input.seed.height ||
    input.sourceSValues.length !== input.seed.width * input.seed.height ||
    !Number.isSafeInteger(input.filledS) ||
    input.filledS <= 0 ||
    !Number.isFinite(input.pixelWidthMm) ||
    input.pixelWidthMm <= 0
  ) {
    return null;
  }
  const repaired = expandHorizontal(input.seed, radiusPx);
  return everyRunSurvives(input.outputMaskFor(repaired), input) ? repaired : null;
}

function expandHorizontal(seed: SelectionMask, radiusPx: number): SelectionMask {
  const alpha = new Uint8Array(seed.alpha.length);
  const deltas = new Int32Array(seed.width + 1);
  for (let y = 0; y < seed.height; y += 1) {
    deltas.fill(0);
    for (let x = 0; x < seed.width; x += 1) {
      if ((seed.alpha[y * seed.width + x] ?? 0) === 0) continue;
      const firstX = Math.max(0, x - radiusPx);
      const endX = Math.min(seed.width, x + radiusPx + 1);
      deltas[firstX] = (deltas[firstX] ?? 0) + 1;
      deltas[endX] = (deltas[endX] ?? 0) - 1;
    }
    let coverage = 0;
    for (let x = 0; x < seed.width; x += 1) {
      coverage += deltas[x] ?? 0;
      if (coverage > 0) alpha[y * seed.width + x] = 255;
    }
  }
  return { width: seed.width, height: seed.height, alpha };
}

function everyRunSurvives(mask: SelectionMask, input: HorizontalMaskRepairInput): boolean {
  if (
    mask.width !== input.seed.width ||
    mask.height !== input.seed.height ||
    mask.alpha.length !== input.sourceSValues.length ||
    mask.alpha.some((value) => value !== 0 && value !== 255)
  ) {
    return false;
  }
  const row = new Float64Array(mask.width);
  let isLost = false;
  const markLost = (): void => {
    isLost = true;
  };
  for (let y = 0; y < mask.height && !isLost; y += 1) {
    const rowOffset = y * mask.width;
    for (let x = 0; x < mask.width; x += 1) row[x] = outputSAt(mask, input, rowOffset + x);
    for (const isReverse of [false, true]) {
      forEachRasterRunLostToDotWidthCorrection(
        row,
        {
          pixelWidthMm: input.pixelWidthMm,
          isReverse,
          dotWidthCorrectionMm: input.dotWidthCorrectionMm,
          minXWorldMm: input.minXWorldMm,
        },
        markLost,
      );
    }
  }
  return !isLost;
}

function outputSAt(mask: SelectionMask, input: HorizontalMaskRepairInput, index: number): number {
  return (mask.alpha[index] ?? 0) > 0 ? input.filledS : (input.sourceSValues[index] ?? 0);
}
