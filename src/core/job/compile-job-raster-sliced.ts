// 3D Sliced image passes (ADR-699). The image's depth grid (darkness 0..255
// per burn cell, from the same resample, sharpen, mask and orientation as
// every other image mode) is cut into one threshold raster per pass at the
// operation's full power; see raster/slice-3d.ts for which pixels each pass
// burns.
//
// A small stack keeps every pass materialized. When the passes together pass
// the streaming threshold, each pass streams its rows from a streamed depth
// provider instead, so memory stays O(width) whatever the slice count.

import type { LayerOperationSettings } from '../scene';
import type { RasterPowerValues } from '../raster/raster-power-values';
import { imageSliceCount, slicePassValues } from '../raster/slice-3d';
import type { RasterGroup } from './job';

export type SlicePass = {
  readonly slices: number;
  readonly passIndex: number;
  /** Depth grids already built for this image, by scan angle. */
  readonly depthByAngle: Map<number, RasterPowerValues>;
};

export type ImageSlicing = {
  /** The slice the next group burns, in burn order. */
  readonly nextPass: () => SlicePass;
};

/** Whether an Image operation burns as 3D Sliced, and with how many slices. */
export function isSlicedImageOperation(
  settings: Pick<LayerOperationSettings, 'ditherAlgorithm' | 'passThrough'>,
): boolean {
  return settings.ditherAlgorithm === '3d-sliced' && !settings.passThrough;
}

/**
 * Hands out each group's slice in burn order. `groupCount` is how many groups
 * the passes compile to: one per pass, or two with Cross-hatch, where both
 * angles of a pass burn the same slice.
 */
export function imageSlicing(
  settings: Pick<LayerOperationSettings, 'ditherAlgorithm' | 'passThrough' | 'passes'>,
  groupCount: number,
): ImageSlicing | null {
  if (!isSlicedImageOperation(settings)) return null;
  const slices = imageSliceCount(settings.passes);
  const groupsPerPass = Math.max(1, Math.round(groupCount / slices));
  const depthByAngle = new Map<number, RasterPowerValues>();
  let group = 0;
  return {
    nextPass: () => {
      const pass = { slices, passIndex: Math.floor(group / groupsPerPass), depthByAngle };
      group += 1;
      return pass;
    },
  };
}

export type SlicedValuesInput = {
  readonly slicePass: SlicePass;
  readonly scanAngleDeg: number;
  readonly pixelCount: number;
  readonly streamedPixelThreshold: number;
  /** S for a burned cell, in compilation units. */
  readonly sOn: number;
  /** Darkness 0..255 per cell of the whole grid. */
  readonly materializeDepth: () => RasterPowerValues;
  /** Darkness 0..255 per cell, one row at a time. */
  readonly streamDepthRows: () => (y: number) => RasterPowerValues;
  readonly toDeviceUnits: (values: RasterPowerValues) => RasterPowerValues;
};

export function slicedRasterValues(
  input: SlicedValuesInput,
): Pick<RasterGroup, 'sValues' | 'rowProvider'> {
  const { slices, passIndex, depthByAngle } = input.slicePass;
  if (input.pixelCount * slices <= input.streamedPixelThreshold) {
    const depth = depthByAngle.get(input.scanAngleDeg) ?? input.materializeDepth();
    depthByAngle.set(input.scanAngleDeg, depth);
    return {
      sValues: input.toDeviceUnits(slicePassValues(depth, passIndex, slices, input.sOn)),
    };
  }
  const depthRow = input.streamDepthRows();
  return {
    sValues: new Float64Array(0),
    rowProvider: (y) =>
      input.toDeviceUnits(slicePassValues(depthRow(y), passIndex, slices, input.sOn)),
  };
}
