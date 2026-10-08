import type { CncTool } from '../scene';
const MAX_RELIEF_CUTTER_LATTICE_CELLS = 1_048_576;
/** Reject unallocatable physical cutter lattices before kernel construction. */
export function reliefCutterBudgetError(tool: CncTool, cellMm: number): string | null {
  if (
    !Number.isFinite(tool.diameterMm) ||
    tool.diameterMm <= 0 ||
    !Number.isFinite(cellMm) ||
    cellMm <= 0
  )
    return 'Relief cutter diameter and sampling grid must be positive finite millimetres.';
  const side = 2 * Math.ceil(tool.diameterMm / 2 / cellMm) + 3;
  return Number.isFinite(side) && side * side <= MAX_RELIEF_CUTTER_LATTICE_CELLS
    ? null
    : 'Cutter envelope exceeds the bounded relief lattice at this requested resolution. Choose an explicit coarser sampling grid or a smaller cutter envelope.';
}
