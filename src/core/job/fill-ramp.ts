// Ramped Fill (ADR-699): a Fill whose Ramp length is set burns as a raster
// at its hatch angle and line interval, with power graded from Min power at
// the shape's edges to full power at the ramp length (raster/fill-ramp-grid.ts).
// Cross-hatch scans it a second time 90 degrees on; an angle change per pass
// reaches here as one operation per angle (fillPassLayers).
//
// A Fill without a ramp never reaches this file, so its output is unchanged.

import type { DeviceProfile } from '../devices';
import type { Layer, Polyline, SceneObject } from '../scene';
import { fillRampGrid } from '../raster/fill-ramp-grid';
import {
  rasterCompilationPowerScale,
  rescaleRasterValuesForVersion,
} from '../raster/controller-power-scale';
import {
  machineToScan,
  normalizedScanAngleDeg,
  rasterScanFrame,
  type RasterScanFrame,
} from '../raster/raster-scan-frame';
import { passAngleStepApplies } from './scan-pass-angles';
import {
  CURRENT_LASER_POWER_SCALE_VERSION,
  type LaserPowerScaleVersion,
} from '../output/laser-power-scale-version';
import { fillScanOverscanMm } from './automatic-overscan';
import type { Group, JobDiagnostic, RasterGroup } from './job';
import { effectiveObjectMinPowerPercent } from './object-power-scale';
import { resolveFillScanDirection } from './scan-direction-policy';
import { validatedScanOffsetMm } from './scan-offset';
import { commonVectorGroupFields } from './vector-group-fields';
import type { VectorCompilation } from './vector-compilation';

const QUARTER_TURN_DEG = 90;
/** Ramp cells are never wider along the scan than this, for a true edge. */
const MAX_RAMP_CELL_MM = 0.1;
/** The grid, its distance field and its S values stay near 200 MB at most. */
const MAX_RAMP_CELLS = 8_000_000;

type PowerSource = SceneObject | { readonly powerScale: number };

/** Whether a Fill operation burns with a ramp. Follow Shape rings have no
 * scan to grade, so they keep their flat burn. */
export function fillRampApplies(
  layer: Pick<Layer, 'mode' | 'fillStyle' | 'fillRampLengthMm'>,
): boolean {
  return (
    layer.mode === 'fill' &&
    layer.fillStyle !== 'offset' &&
    layer.fillRampLengthMm !== undefined &&
    Number.isFinite(layer.fillRampLengthMm) &&
    layer.fillRampLengthMm > 0
  );
}

/**
 * ADR-699 Amendment 1, after ADR-492 D9: a rotary keeps only scan rows along X
 * straight, so a ramped Fill on a rotary scans every pass along X, as an image
 * does. Its hatch angle, Cross-hatch and angle per pass are set aside, and
 * `turnedAside` says whether any of them asked for something else. Null when
 * the operation has no ramp or the rotary is off: those compile as before.
 */
export function rotaryRampLayer<T extends Layer>(
  layer: T,
  device: Pick<DeviceProfile, 'rotary'>,
): { readonly layer: T; readonly turnedAside: boolean } | null {
  if (!fillRampApplies(layer) || device.rotary?.enabled !== true) return null;
  const turnedAside =
    normalizedScanAngleDeg(layer.hatchAngleDeg) !== 0 ||
    layer.fillCrossHatch ||
    passAngleStepApplies(layer);
  return {
    layer: { ...layer, hatchAngleDeg: 0, fillCrossHatch: false, passAngleStepDeg: 0 },
    turnedAside,
  };
}

export function rampedFillGroups(args: {
  readonly contours: ReadonlyArray<Polyline>;
  readonly layer: Layer;
  readonly device: DeviceProfile;
  readonly powerSource: PowerSource;
  readonly sourceObjectId?: string | undefined;
  readonly laserPowerScaleVersion?: LaserPowerScaleVersion | undefined;
}): VectorCompilation {
  const { layer } = args;
  const angles = layer.fillCrossHatch
    ? [layer.hatchAngleDeg, layer.hatchAngleDeg + QUARTER_TURN_DEG]
    : [layer.hatchAngleDeg];
  const groups: Group[] = [];
  const diagnostics: JobDiagnostic[] = [];
  for (const angle of angles) {
    const result = rampedFillGroup(args, rasterScanFrame(angle));
    if (result.kind === 'group') groups.push(result.group);
    else if (result.kind === 'too-large')
      diagnostics.push({ kind: 'fill-ramp-too-large', layerName: layer.name, cells: result.cells });
  }
  return { groups, diagnostics };
}

type RampedGroupResult =
  | { readonly kind: 'group'; readonly group: RasterGroup }
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-large'; readonly cells: number };

function rampedFillGroup(
  args: Parameters<typeof rampedFillGroups>[0],
  scanFrame: RasterScanFrame,
): RampedGroupResult {
  const { layer, device } = args;
  const version = args.laserPowerScaleVersion ?? CURRENT_LASER_POWER_SCALE_VERSION;
  const common = commonVectorGroupFields(layer, device, args.powerSource, args.sourceObjectId);
  const compilationMaxS = rasterCompilationPowerScale(device, version);
  const minPercent = effectiveObjectMinPowerPercent(layer, args.powerSource);
  const pitchYmm = layer.hatchSpacingMm;
  const result = fillRampGrid({
    contours: args.contours.map((contour) => ({
      closed: contour.closed,
      points: contour.points.map((point) => machineToScan(scanFrame, point)),
    })),
    pitchYmm,
    pitchXmm: Math.min(pitchYmm, MAX_RAMP_CELL_MM),
    rampLengthMm: layer.fillRampLengthMm ?? 0,
    rampOuterEdge: layer.fillRampOuterEdge === true,
    sMax: (common.power / 100) * compilationMaxS,
    sMin: (minPercent / 100) * compilationMaxS,
    maxCells: MAX_RAMP_CELLS,
  });
  if (result.kind !== 'ok') return result;
  const { grid } = result;
  const scanDirection = resolveFillScanDirection(device, layer);
  const scanOffsetMm = validatedScanOffsetMm(device, layer.bidirectionalScanOffsetMm);
  const sValues =
    compilationMaxS === device.maxPowerS
      ? grid.sValues
      : rescaleRasterValuesForVersion(grid.sValues, compilationMaxS, device.maxPowerS, version);
  return {
    kind: 'group',
    group: {
      ...rasterFields(common),
      kind: 'raster',
      fillRamp: true,
      sValues,
      pixelWidth: grid.width,
      pixelHeight: grid.height,
      bounds: grid.bounds,
      overscanMm: fillScanOverscanMm({ ...layer, hatchAngleDeg: scanFrame.angleDeg }, device),
      dotWidthCorrectionMm: 0,
      bidirectional: scanDirection.bidirectional,
      scanDirection,
      ...(scanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm: scanOffsetMm }),
      ...(scanFrame.angleDeg === 0 ? {} : { scanAngleDeg: scanFrame.angleDeg }),
    },
  };
}

// The vector fields a raster group shares; a power mode or runway is not one.
function rasterFields(
  common: ReturnType<typeof commonVectorGroupFields>,
): Omit<
  RasterGroup,
  | 'kind'
  | 'sValues'
  | 'pixelWidth'
  | 'pixelHeight'
  | 'bounds'
  | 'overscanMm'
  | 'dotWidthCorrectionMm'
> {
  return {
    layerId: common.layerId,
    ...(common.sourceObjectId === undefined ? {} : { sourceObjectId: common.sourceObjectId }),
    color: common.color,
    power: common.power,
    speed: common.speed,
    ...(common.requestedSpeed === undefined ? {} : { requestedSpeed: common.requestedSpeed }),
    ...(common.operationSettings === undefined
      ? {}
      : { operationSettings: common.operationSettings }),
    passes: common.passes,
    airAssist: common.airAssist,
  };
}
