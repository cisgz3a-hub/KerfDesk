import type { FillGroup, Job, RasterGroup } from '../../core/job';
import { effectiveGcodeFeedMmPerMin } from '../../core/gcode/feed-word';
import {
  feedMatchedFillRunwayMm,
  genericFeedMatchedFillRunwayMm,
} from '../../core/job/fill-sweep-plan';
import { alongScanAccelMmPerSec2 } from '../../core/job/automatic-overscan';
import { accelerationDistanceMm } from '../../core/job/operation-cut-extras';
import { outputOperationLayers, type Project } from '../../core/scene';

const CONTROLLER_GRID_MM = 0.001;

/** Geometry-only advisories: never read a streamed row provider or change output. */
export function scanQualityWarnings(job: Job, project: Project): ReadonlyArray<string> {
  if (project.machine?.kind === 'cnc') return [];
  const names = new Map(
    project.scene.layers.flatMap(outputOperationLayers).map((layer) => [layer.id, layer.name]),
  );
  const warnings = new Set<string>();
  for (const group of job.groups) {
    if (!isPoweredScan(group)) continue;
    const operationName = names.get(group.layerId) ?? group.layerId;
    const label =
      group.kind === 'raster'
        ? `Image "${group.source ?? 'image'}" on "${operationName}"`
        : `Fill operation "${operationName}"`;
    const runway = runwayWarning(group, label, project.device.accelMmPerSec2);
    if (runway !== null) warnings.add(runway);
    if (group.kind !== 'raster') continue;
    const correction = dotWidthWarning(group, label);
    if (correction !== null) warnings.add(correction);
  }
  return [...warnings];
}

function isPoweredScan(group: Job['groups'][number]): group is FillGroup | RasterGroup {
  if (group.kind === 'raster') {
    return group.power > 0 && group.pixelWidth > 0 && group.pixelHeight > 0;
  }
  return (
    group.kind === 'fill' &&
    group.power > 0 &&
    group.fillStyle !== 'offset' &&
    group.segments.length > 0
  );
}

function runwayWarning(
  group: FillGroup | RasterGroup,
  label: string,
  acceleration: number,
): string | null {
  const feed = effectiveGcodeFeedMmPerMin(group.speed);
  // ADR-495: a scan off the axes gets more acceleration than either axis alone.
  const angleDeg = scanAngleDegOf(group);
  const alongScan = alongScanAccelMmPerSec2(acceleration, angleDeg);
  const needed = accelerationDistanceMm(feed, alongScan);
  const available = maximumRunway(group);
  if (!Number.isFinite(needed) || needed <= available + CONTROLLER_GRID_MM) return null;
  const accelText =
    alongScan === acceleration
      ? `${formatMm(acceleration)} mm/s²`
      : `${formatMm(acceleration)} mm/s² (${formatMm(alongScan)} mm/s² along its ${formatMm(angleDeg)}° scan)`;
  return (
    `${label} has at most ${formatMm(available)} mm of scan-entry runway. ` +
    `At ${formatMm(feed)} mm/min, the saved acceleration of ${accelText} ` +
    `needs about ${formatMm(needed)} mm to reach that speed from rest. ` +
    'Blank gaps can shorten the runway further. Review Overscan or reduce speed, then test the ' +
    'scan edges on scrap. This is a saved-motion estimate, not a measured machine limit.'
  );
}

// The direction a group scans in: an image's scan angle, a fill's first hatch.
function scanAngleDegOf(group: FillGroup | RasterGroup): number {
  if (group.kind === 'raster') return group.scanAngleDeg ?? 0;
  for (const segment of group.segments) {
    const [a, b] = segment.polyline;
    if (a === undefined || b === undefined || (a.x === b.x && a.y === b.y)) continue;
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return ((deg % 180) + 180) % 180;
  }
  return 0;
}

function maximumRunway(group: FillGroup | RasterGroup): number {
  if (group.kind === 'raster') return Math.max(0, group.overscanMm);
  if (group.fillRunwayPolicy === 'feed-matched-every-sweep') {
    return genericFeedMatchedFillRunwayMm(group.overscanMm);
  }
  if (group.fillRunwayPolicy === 'feed-matched-entry') {
    return feedMatchedFillRunwayMm(group.overscanMm);
  }
  return Math.max(0, group.overscanMm);
}

function dotWidthWarning(group: RasterGroup, label: string): string | null {
  const correction = group.dotWidthCorrectionMm;
  const pitch = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  if (!(correction > 0) || !(pitch > 0) || !Number.isFinite(pitch)) return null;
  const remaining = pitch - 2 * correction;
  if (remaining > CONTROLLER_GRID_MM) return null;
  const effect =
    remaining <= 0
      ? 'removes an isolated one-pixel powered run'
      : `leaves only ${formatMm(remaining)} mm of a one-pixel powered run, which can disappear when coordinates are rounded`;
  return (
    `${label} has ${formatMm(pitch)} mm pixels along the scan. Dot Width Correction shortens ` +
    `each end by ${formatMm(correction)} mm and ${effect}. ` +
    'Lower Dot Width Correction or confirm the corrected output with a detail test; ' +
    'the source image alone does not show this loss.'
  );
}

function formatMm(value: number): string {
  return Number(value.toFixed(4)).toString();
}
