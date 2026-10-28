import type { Job, RasterGroup } from '../../core/job';
import {
  passThroughLinesUpWithScan,
  passThroughPixelPitchMm,
  scanAngleAlongImageDeg,
} from '../../core/job/raster-pass-through-grid';
import { rasterScanFrame } from '../../core/raster/raster-scan-frame';
import {
  outputOperationLayers,
  type Layer,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';

// ADR-492 Amendment 1: Pass-Through burns an image's own pixels only while its
// pixel rows run along the scan rows (or straight across them). Turned to any
// other angle, compile keeps the image's pixel size, but each burn cell takes
// the nearest source pixel, so single pixels of a pre-dithered pattern drop out
// or double up while the canvas draws them all. LightBurn's answer is that a
// Pass-Through image cannot be rotated. Say so and name the ways to burn every
// pixel once. Warning only — never a gate (rule 7).
export function rasterPassThroughWarnings(job: Job, project: Project): ReadonlyArray<string> {
  if (project.machine?.kind === 'cnc') return [];
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  const warned = new Set<string>();
  const warnings: string[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'raster') continue;
    const turned = turnedPassThrough(group, operations, project);
    // One line per image and operation, whichever of its passes are turned.
    const key = `${group.sourceObjectId}:${group.layerId}`;
    if (turned === null || warned.has(key)) continue;
    warned.add(key);
    warnings.push(describeTurnedPassThrough(group, turned.layer, turned.obj, project));
  }
  return warnings;
}

function turnedPassThrough(
  group: RasterGroup,
  operations: ReadonlyArray<Layer>,
  project: Project,
): { readonly layer: Layer; readonly obj: RasterImage } | null {
  const layer = operations.find((operation) => operation.id === group.layerId);
  const obj = project.scene.objects.find((candidate) => candidate.id === group.sourceObjectId);
  if (layer === undefined || obj?.kind !== 'raster-image') return null;
  if (!effectiveOperationForObject(layer, obj).passThrough) return null;
  const frame = rasterScanFrame(group.scanAngleDeg);
  return passThroughLinesUpWithScan(obj, project.device, frame) ? null : { layer, obj };
}

function describeTurnedPassThrough(
  group: RasterGroup,
  layer: Layer,
  obj: RasterImage,
  project: Project,
): string {
  // A rotary scans every pass along X (ADR-492 Decision 9), so no scan angle
  // can follow the image there.
  const alongImage =
    project.device.rotary?.enabled === true
      ? ''
      : `set the scan angle to ${format(scanAngleAlongImageDeg(obj, project.device))}°, `;
  return (
    `Image "${group.source}" on "${layer.name}" uses original pixels (Pass-through), but it is ` +
    `turned ${format(signedTurnDeg(obj.transform.rotationDeg))}° and scans at ` +
    `${format(group.scanAngleDeg ?? 0)}°, so its pixel rows cannot follow the burn rows. KerfDesk ` +
    `keeps its ${format(passThroughPixelPitchMm(obj))} mm pixel size, but each burn cell takes the ` +
    'nearest source pixel: single pixels of a pre-dithered pattern can drop out or double up as a ' +
    `moiré the canvas does not show. To burn every pixel once, ${alongImage}turn the image to a ` +
    'multiple of 90°, or rotate it in the program that made it and import it again. Or turn Use ' +
    "original pixels off, so KerfDesk resamples it at the operation's lines/mm."
  );
}

// The image's turn as the canvas shows it, in (-180, 180].
function signedTurnDeg(rotationDeg: number): number {
  const turn = ((rotationDeg % 360) + 360) % 360;
  return turn > 180 ? turn - 360 : turn;
}

function format(value: number): string {
  return Number(value.toFixed(value < 1 && value > -1 ? 3 : 1)).toString();
}
