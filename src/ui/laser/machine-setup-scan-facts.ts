import { compileJob, type FillGroup, type Job, type RasterGroup } from '../../core/job';
import { layerFromSubLayer, type Layer, type Project } from '../../core/scene';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';
import { planFillSweeps } from '../../core/job/fill-sweep-plan';
import { rasterRowsInProviderOrder } from '../../core/job/raster-rows';
import { offsetForEmittedFeed, type ScanOffsetPoint } from '../../core/job/scan-offset';
import { planRasterRowSweeps } from '../../core/raster/raster-sweep-plan';
import { effectiveGcodeFeedMmPerMin } from '../../core/gcode/feed-word';

const CALIBRATION_OVERSCAN_FRACTION = 0.05;

type ScanGroup = FillGroup | RasterGroup;

export type MachineSetupScanFacts = {
  readonly requestedImageOperations: number;
  readonly requestedFillOperations: number;
  readonly requestedBidirectionalOperations: number;
  readonly executableScanGroups: number | null;
  readonly effectiveBidirectionalGroups: number | null;
  readonly profileFallbackGroups: number | null;
  readonly lowOverscanGroups: number | null;
  readonly compiledJob: Job | null;
  readonly operationLayers: ReadonlyArray<Layer>;
};

export function buildMachineSetupScanFacts(project: Project): MachineSetupScanFacts {
  const operationLayers = flattenOutputOperationLayers(project);
  const requestedImageOperations = operationLayers.filter((layer) => layer.mode === 'image').length;
  const requestedFillOperations = operationLayers.filter((layer) => layer.mode === 'fill').length;
  const requestedBidirectionalOperations = operationLayers.filter(requestsBidirectionalScan).length;
  if (costlyCanvasPreparation(project)) {
    return {
      requestedImageOperations,
      requestedFillOperations,
      requestedBidirectionalOperations,
      executableScanGroups: null,
      effectiveBidirectionalGroups: null,
      profileFallbackGroups: null,
      lowOverscanGroups: null,
      compiledJob: null,
      operationLayers,
    };
  }
  const compiledJob = compileJob(project.scene, project.device);
  const groups = compiledJob.groups.filter(isScanGroup);
  const effectiveBidirectionalGroups = groups.filter(
    (group) => group.scanDirection?.bidirectional === true,
  );
  return {
    requestedImageOperations,
    requestedFillOperations,
    requestedBidirectionalOperations,
    executableScanGroups: groups.length,
    effectiveBidirectionalGroups: effectiveBidirectionalGroups.length,
    profileFallbackGroups: groups.filter((group) => {
      const reason = group.scanDirection?.reason;
      return (
        reason === 'pending-calibration-profile-fallback' ||
        reason === 'uncalibrated-profile-fallback' ||
        reason === 'pending-calibration-4040-fallback' ||
        reason === 'uncalibrated-4040-fallback'
      );
    }).length,
    lowOverscanGroups: effectiveBidirectionalGroups.filter(
      (group) =>
        minimumActualRunwayMm(group, project.device.scanningOffsets) + 1e-9 <
        calibrationReferenceRunwayMm(group.speed),
    ).length,
    compiledJob,
    operationLayers,
  };
}

function calibrationReferenceRunwayMm(feedMmPerMin: number): number {
  return (effectiveGcodeFeedMmPerMin(feedMmPerMin) / 60) * CALIBRATION_OVERSCAN_FRACTION;
}

function minimumActualRunwayMm(
  group: ScanGroup,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
): number {
  const scanOffsetMm =
    group.bidirectionalScanOffsetMm ?? offsetForEmittedFeed(scanningOffsets, group.speed);
  if (group.kind === 'fill') {
    return minimumPlannedRunway(planFillSweeps(group, scanOffsetMm));
  }
  let minimumRunwayMm = Number.POSITIVE_INFINITY;
  let emittedRowCount = 0;
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  for (const { row } of rasterRowsInProviderOrder(group)) {
    if (!row.some((power) => power > 0)) continue;
    minimumRunwayMm = Math.min(
      minimumRunwayMm,
      minimumPlannedRunway(
        planRasterRowSweeps({
          row,
          pixelWidthMm,
          overscanMm: group.overscanMm,
          reverse: (group.bidirectional ?? true) && emittedRowCount % 2 === 1,
          dotWidthCorrectionMm: group.dotWidthCorrectionMm,
          minXWorldMm: group.bounds.minX,
        }),
      ),
    );
    emittedRowCount += 1;
  }
  return minimumRunwayMm;
}

function minimumPlannedRunway(
  plans: ReadonlyArray<{ readonly leadInMm: number; readonly leadOutMm: number }>,
): number {
  let minimumRunwayMm = Number.POSITIVE_INFINITY;
  for (const plan of plans) {
    minimumRunwayMm = Math.min(minimumRunwayMm, plan.leadInMm, plan.leadOutMm);
  }
  return minimumRunwayMm;
}

function isScanGroup(group: Job['groups'][number]): group is ScanGroup {
  return group.kind === 'fill' || group.kind === 'raster';
}

function requestsBidirectionalScan(layer: Layer): boolean {
  if (layer.mode === 'image') return layer.imageBidirectional;
  return (
    layer.mode === 'fill' &&
    (layer.fillStyle === 'scanline' || layer.fillStyle === 'island') &&
    layer.fillBidirectional
  );
}

function flattenOutputOperationLayers(project: Project): ReadonlyArray<Layer> {
  return project.scene.layers
    .flatMap((layer) => [
      layer,
      ...layer.subLayers.map((subLayer) => layerFromSubLayer(layer, subLayer)),
    ])
    .filter((layer) => layer.output);
}
