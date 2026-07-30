import type { DeviceProfile } from '../../core/devices';
import type { RgbaBuffer } from '../../core/image-edit';
import type { RasterGroup } from '../../core/job';
import { compileRasterGroupsForLayer } from '../../core/job/raster';
import {
  outputOperationLayers,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { rasterOutputRunLoss, type RasterOutputLoss } from './raster-output-run-loss';

const MAX_KERF_REPAIR_MASK_PIXELS = 250_000;
const RGBA_CHANNELS = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const LUMA_RED_WEIGHT = 0.299;
const LUMA_GREEN_WEIGHT = 0.587;
const LUMA_BLUE_WEIGHT = 0.114;

/** Raster-group facts required to map one reversible Thicken action. */
export type RasterKerfGroupFacts = Pick<
  RasterGroup,
  'layerId' | 'sValues' | 'pixelWidth' | 'pixelHeight' | 'bounds' | 'dotWidthCorrectionMm'
> & {
  /** Exact Uint16 output power produced by filling one source pixel black. */
  readonly blackS: number;
};

/** Minimal, structured-clone-safe input for one output-facing kerf analysis. */
export type KerfOutputParityInput = {
  readonly composite: RgbaBuffer;
  readonly object: RasterImage;
  readonly layers: ReadonlyArray<Layer>;
  readonly maskObject: SceneObject | null;
  readonly device: DeviceProfile;
  readonly appliedBounds: RasterImage['bounds'];
};

/** Compiled exact-S loss plus any bounded output-grid repair candidate. */
export type KerfOutputParity = {
  /** Raster output samples erased by dot-width correction across operations. */
  readonly removedPixels: number;
  /** Smallest correction among operations that lost output samples. */
  readonly minCorrectionMm: number;
  /** Largest correction among operations that lost output samples. */
  readonly maxCorrectionMm: number;
  /**
   * Present only for one operation whose output-grid loss mask stayed within
   * the advisory's bounded repair-memory budget.
   */
  readonly thickenCandidate: {
    readonly group: RasterKerfGroupFacts;
    readonly removed: RasterOutputLoss;
  } | null;
};

/**
 * Compile only the edited raster and its real output-operation topology, then
 * inspect the same post-adjustment/resample/mask/dither exact-S runs used by
 * raster emission. This pure unbounded computation belongs in the kerf worker.
 */
export function computeKerfOutputParity(input: KerfOutputParityInput): KerfOutputParity | null {
  const object = virtualAppliedObject(input);
  const sourceLuma = compositeLuma(input.composite);
  const groups = compiledRasterGroups(input, object, sourceLuma);
  if (groups.length === 0) return null;
  const removedByGroup = groups.map((group) => ({
    group,
    removed: rasterOutputRunLoss(group, {
      shouldCaptureMask: groups.length === 1 && canCaptureRepairMask(group),
    }),
  }));
  if (removedByGroup.some((entry) => entry.removed === null)) return null;
  const losses = removedByGroup.flatMap((entry) =>
    entry.removed === null || entry.removed.pixels === 0
      ? []
      : [{ group: entry.group, removed: entry.removed }],
  );
  const correctionRange = correctionRangeFor(losses);
  const only = losses.length === 1 && groups.length === 1 ? losses[0] : undefined;
  return {
    removedPixels: losses.reduce((sum, entry) => sum + entry.removed.pixels, 0),
    minCorrectionMm: correctionRange.min,
    maxCorrectionMm: correctionRange.max,
    thickenCandidate:
      only?.removed.mask === null || only === undefined
        ? null
        : { group: rasterKerfGroupFacts(only.group, input.device), removed: only.removed },
  };
}

function correctionRangeFor(losses: ReadonlyArray<{ readonly group: RasterGroup }>): {
  readonly min: number;
  readonly max: number;
} {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const { group } of losses) {
    min = Math.min(min, group.dotWidthCorrectionMm);
    max = Math.max(max, group.dotWidthCorrectionMm);
  }
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}

function virtualAppliedObject(input: KerfOutputParityInput): RasterImage {
  return {
    ...input.object,
    pixelWidth: input.composite.width,
    pixelHeight: input.composite.height,
    bounds: input.appliedBounds,
  };
}

function compiledRasterGroups(
  input: KerfOutputParityInput,
  object: RasterImage,
  sourceLuma: Uint8Array,
): RasterGroup[] {
  const objects: SceneObject[] = [object];
  if (input.maskObject !== null) objects.push(input.maskObject);
  const sourceLumaByObjectId = new Map([[object.id, sourceLuma]]);
  return input.layers.flatMap((layer) =>
    outputOperationLayers(layer).flatMap((operation) =>
      compileRasterGroupsForLayer([object], operation, input.device, {
        sceneObjects: objects,
        sourceLumaByObjectId,
      }),
    ),
  );
}

function compositeLuma(composite: RgbaBuffer): Uint8Array {
  const luma = new Uint8Array(composite.width * composite.height);
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * RGBA_CHANNELS;
    const red = composite.data[offset + RED_OFFSET] ?? 0;
    const green = composite.data[offset + GREEN_OFFSET] ?? 0;
    const blue = composite.data[offset + BLUE_OFFSET] ?? 0;
    luma[index] = Math.round(
      LUMA_RED_WEIGHT * red + LUMA_GREEN_WEIGHT * green + LUMA_BLUE_WEIGHT * blue,
    );
  }
  return luma;
}

function canCaptureRepairMask(group: RasterGroup): boolean {
  const pixels = group.pixelWidth * group.pixelHeight;
  return (
    Number.isSafeInteger(pixels) &&
    pixels > 0 &&
    pixels <= MAX_KERF_REPAIR_MASK_PIXELS &&
    group.rowProvider === undefined &&
    group.rowProviderOrder === undefined &&
    group.sValues.length === pixels
  );
}

function rasterKerfGroupFacts(group: RasterGroup, device: DeviceProfile): RasterKerfGroupFacts {
  return {
    layerId: group.layerId,
    sValues: group.sValues,
    blackS: Uint16Array.of(Math.round((group.power / 100) * device.maxPowerS))[0] ?? 0,
    pixelWidth: group.pixelWidth,
    pixelHeight: group.pixelHeight,
    bounds: group.bounds,
    dotWidthCorrectionMm: group.dotWidthCorrectionMm,
  };
}
