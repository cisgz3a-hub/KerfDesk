import type { Job, RasterGroup } from '../../core/job';
import { compiledLinesPerMm } from '../../core/raster/luma-resample';
import { outputOperationLayers, type Layer, type Project } from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';

// Threshold keeps one source pixel per burn cell (ADR-359): averaging a cell
// and cutting at 128 would erase every stroke of either polarity covering half
// a cell or less. So when a Threshold image is stored at least twice as dense
// as its burn grid, lines and dots narrower than a cell are dropped or widened
// to a whole cell depending on where the sample lands — the canvas still
// shows every one. Say so, and name the mode that keeps them. Warning only —
// never a gate (rule 7).
const DECIMATION_ADVISORY_FACTOR = 2;

export function rasterThresholdWarnings(job: Job, project: Project): ReadonlyArray<string> {
  if (project.machine?.kind === 'cnc') return [];
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  const warnings = new Set<string>();
  for (const group of job.groups) {
    if (group.kind !== 'raster') continue;
    const warning = describeThresholdDecimation(group, operations, project);
    if (warning !== null) warnings.add(warning);
  }
  return [...warnings];
}

function describeThresholdDecimation(
  group: RasterGroup,
  operations: ReadonlyArray<Layer>,
  project: Project,
): string | null {
  const layer = operations.find((operation) => operation.id === group.layerId);
  const obj = project.scene.objects.find((candidate) => candidate.id === group.sourceObjectId);
  if (layer === undefined || obj?.kind !== 'raster-image') return null;
  const op = effectiveOperationForObject(layer, obj);
  if (op.ditherAlgorithm !== 'threshold' || op.passThrough) return null;
  const linesPerMm = compiledLinesPerMm(op.linesPerMm);
  const widthMm = (obj.bounds.maxX - obj.bounds.minX) * Math.abs(obj.transform.scaleX);
  const heightMm = (obj.bounds.maxY - obj.bounds.minY) * Math.abs(obj.transform.scaleY);
  const sourcePxPerMm = Math.min(obj.pixelWidth / widthMm, obj.pixelHeight / heightMm);
  if (!Number.isFinite(sourcePxPerMm) || sourcePxPerMm < DECIMATION_ADVISORY_FACTOR * linesPerMm) {
    return null;
  }
  return (
    `Image "${group.source}" on "${layer.name}" uses Threshold at ${format(linesPerMm)} lines/mm on a ` +
    `source stored at ${format(sourcePxPerMm)} px/mm. Each burn cell keeps one source pixel, so lines ` +
    `and dots narrower than ${format(1 / linesPerMm)} mm are dropped or widened to a full cell, ` +
    "depending on where each cell's sample falls, although the canvas shows them all. A dithered mode such as " +
    'Floyd-Steinberg keeps them as proportional texture.'
  );
}

function format(value: number): string {
  return Number(value.toFixed(value < 1 ? 3 : 1)).toString();
}
