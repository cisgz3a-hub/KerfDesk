// detectCncStockWarnings — CNC-mode advisory: the compiled job's XY extent
// leaves the stock footprint (Phase H.2, ADR-098). Bed bounds stay a hard
// preflight ERROR; leaving the stock is only an advisory because cutting into
// an offcut edge or jig is often intentional — the operator decides.
//
// A supplied prepared job is already in the physical output coordinate frame,
// including its resolved placement. This is a heads-up, never a gate.

import { compileCncJob } from '../../core/cnc';
import { computeJobBounds } from '../../core/job';
import { computeEmittedJobBounds } from '../../core/job/job-bounds';
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
      : computeEmittedJobBounds(prepared.job);
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
