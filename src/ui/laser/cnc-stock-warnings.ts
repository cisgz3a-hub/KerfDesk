// detectCncStockWarnings — CNC-mode advisory: the compiled job's XY extent
// leaves the stock footprint (Phase H.2, ADR-098). Bed bounds stay a hard
// preflight ERROR; leaving the stock is only an advisory because cutting into
// an offcut edge or jig is often intentional — the operator decides.
//
// Bounds are compile-time machine coordinates (the same frame the CNC
// pipeline emits in); job-placement offsets applied at save/start time are
// intentionally not modeled here — this is a heads-up, not a gate.

import { compileCncJob } from '../../core/cnc';
import { computeJobBounds, type JobBounds } from '../../core/job';
import type { Project } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';

export function detectCncStockWarnings(
  project: Project,
  prepared?: Extract<PreparedOutput, { readonly ok: true }>,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return [];
  const bounds =
    prepared === undefined
      ? computeJobBounds(compileCncJob(project.scene, project.device, machine))
      : unplacedPreparedBounds(prepared);
  if (bounds === null) return [];

  const stock = machine.stock;
  const minX = stock.originOffset.x;
  const minY = stock.originOffset.y;
  const maxX = minX + stock.widthMm;
  const maxY = minY + stock.heightMm;
  const fitsStock =
    bounds.minX >= minX && bounds.minY >= minY && bounds.maxX <= maxX && bounds.maxY <= maxY;
  if (fitsStock) return [];

  return [
    `Toolpaths span ${bounds.minX.toFixed(1)}–${bounds.maxX.toFixed(1)} × ` +
      `${bounds.minY.toFixed(1)}–${bounds.maxY.toFixed(1)} mm, outside the ` +
      `${stock.widthMm} × ${stock.heightMm} mm stock at (${minX}, ${minY}). ` +
      'The bit will cut air or your clamps/spoilboard — check the stock size and position.',
  ];
}

function unplacedPreparedBounds(
  prepared: Extract<PreparedOutput, { readonly ok: true }>,
): JobBounds | null {
  const bounds = computeJobBounds(prepared.job);
  if (bounds === null) return null;
  const offset = prepared.jobOriginOffset;
  return {
    minX: bounds.minX - offset.x,
    minY: bounds.minY - offset.y,
    maxX: bounds.maxX - offset.x,
    maxY: bounds.maxY - offset.y,
  };
}
