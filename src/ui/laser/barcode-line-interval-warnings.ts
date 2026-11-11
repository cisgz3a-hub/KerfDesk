// Barcodes whose modules are narrower than their Fill line interval (ADR-386
// Amendment 3, Oracle audit O1-P2-1). A scanline Fill burns one line every
// interval; when the interval is wider than a module, whole rows of modules
// fall between two lines and are never burned, so the code cannot scan however
// exact its outlines are. Job Review names each such code. A warning, never a
// refusal (PROJECT.md non-negotiable 21).
//
// Matrix codes (QR Code, Data Matrix) lose rows whatever the scan angle. A 1D
// code loses bars only when every line runs along its bars: any other angle,
// or a cross-hatch pass, crosses every bar and keeps its widths exact. Follow
// Shape fills trace each outline first, so they are not checked.

import { isBarcodeObject, isMatrixSymbology, layoutBarcode } from '../../core/barcode';
import type { BarcodeObject } from '../../core/barcode';
import { sceneAxisSigns } from '../../core/devices';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';

const MAX_NAMED_BARCODES = 4;
// Floating-point slack, so an interval equal to the module is not flagged.
const INTERVAL_SLACK_MM = 1e-9;
// Lines within this angle of a 1D code's bars run along them.
const PARALLEL_TOLERANCE_DEG = 1;

/** Reads the prepared project, where each variable barcode holds this output's value. */
export function detectBarcodeLineIntervalWarnings(project: Project): ReadonlyArray<string> {
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  const signs = sceneAxisSigns(project.device.origin);
  const warnings: string[] = [];
  for (const object of project.scene.objects) {
    if (!isBarcodeObject(object)) continue;
    const coarsest = coarsestSkippingInterval(object, operations, signs);
    if (coarsest !== null) warnings.push(message(object.id, coarsest));
  }
  if (warnings.length <= MAX_NAMED_BARCODES) return warnings;
  const extra = warnings.length - MAX_NAMED_BARCODES;
  return [
    ...warnings.slice(0, MAX_NAMED_BARCODES),
    `${extra} more barcode${extra === 1 ? ' has' : 's have'} modules narrower than the Fill line interval.`,
  ];
}

type Finding = { readonly moduleMm: number; readonly intervalMm: number };

function coarsestSkippingInterval(
  object: BarcodeObject,
  operations: ReadonlyArray<Layer>,
  signs: { readonly x: number; readonly y: number },
): Finding | null {
  const moduleMm = placedModuleMm(object);
  if (moduleMm === null) return null;
  let worst: Finding | null = null;
  for (const operation of operations) {
    if (!sceneObjectUsesOperation(object, operation)) continue;
    const effective = effectiveOperationForObject(operation, object);
    if (effective.mode !== 'fill' || effective.fillStyle === 'offset') continue;
    if (!(effective.hatchSpacingMm > moduleMm + INTERVAL_SLACK_MM)) continue;
    if (!isMatrixSymbology(object.spec.symbology) && !scansAlongBars(object, effective, signs)) {
      continue;
    }
    if (worst === null || effective.hatchSpacingMm > worst.intervalMm) {
      worst = { moduleMm, intervalMm: effective.hatchSpacingMm };
    }
  }
  return worst;
}

// The module as burned: the dialog's size times the object's scale. A 1D
// code's module runs across its bars, along the object's X axis.
function placedModuleMm(object: BarcodeObject): number | null {
  const laid = layoutBarcode(object.spec, object.spec.data, 'output');
  if (!laid.ok) return null;
  const { scaleX, scaleY } = object.transform;
  const scale = isMatrixSymbology(object.spec.symbology)
    ? Math.min(Math.abs(scaleX), Math.abs(scaleY))
    : Math.abs(scaleX);
  return laid.layout.moduleMm * scale;
}

// Fill lines run at the operation's angle in machine coordinates; the bars run
// along the object's local Y axis, placed by its transform and the bed origin.
function scansAlongBars(
  object: BarcodeObject,
  operation: Layer,
  signs: { readonly x: number; readonly y: number },
): boolean {
  if (operation.fillCrossHatch) return false;
  const { scaleY, mirrorY, rotationDeg } = object.transform;
  const along = (mirrorY ? -1 : 1) * Math.sign(scaleY || 1);
  const rad = (rotationDeg * Math.PI) / 180;
  const barX = -Math.sin(rad) * along * signs.x;
  const barY = Math.cos(rad) * along * signs.y;
  const scan = (operation.hatchAngleDeg * Math.PI) / 180;
  const cross = Math.abs(Math.cos(scan) * barY - Math.sin(scan) * barX);
  return cross <= Math.sin((PARALLEL_TOLERANCE_DEG * Math.PI) / 180);
}

function message(id: string, finding: Finding): string {
  const module = finding.moduleMm.toFixed(2);
  const interval = finding.intervalMm.toFixed(2);
  // Rounded down, so the advice never exceeds half the module.
  const advised = (Math.floor((finding.moduleMm / 2) * 100) / 100).toFixed(2);
  return (
    `Barcode ${id} has ${module} mm modules but a ${interval} mm Fill line interval, so whole ` +
    `rows of modules get no line and the code will not scan. Set the interval to ${advised} mm ` +
    'or less, or make the code larger.'
  );
}
