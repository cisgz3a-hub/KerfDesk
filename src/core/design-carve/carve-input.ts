// carve-input — the vocabulary of the instant carve preview (ADR-272
// Amendment 1 clause 4). Pure data in, one Heightmap out; the UI decides grid
// resolution and which frame the origin lives in (the math is frame-agnostic,
// the caller must simply be consistent, per the ADR-261 one-frame rule).

import type { CncTool } from '../scene';
import type { Sketch } from '../design';

export type CarveStock = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly thicknessMm: number;
  // Grid min corner in the caller's frame (sketch mm). Entities outside the
  // stock simply rasterize off-grid — informing, never refusing (rule 7).
  readonly originX: number;
  readonly originY: number;
};

export type CarveGrid = {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly mmPerCell: number;
  readonly originX: number;
  readonly originY: number;
};

export type DesignCarveInput = {
  readonly sketch: Sketch;
  readonly stock: CarveStock;
  readonly mmPerCell: number;
  // The machine's tool table plus its active bit: a layer without a toolId
  // cuts with the active bit, exactly like CncLayerSettings.toolId.
  readonly tools: ReadonlyArray<CncTool>;
  readonly activeTool: CncTool;
};

// Matches core/sim tool-kernels and core/cnc vcarve-ladder: a v-bit with a
// missing or degenerate tip angle previews as 60 degrees, so the preview and
// the toolpath fall back identically.
export const FALLBACK_V_TIP_ANGLE_DEG = 60;

export const MIN_CARVE_CELL_MM = 0.05;

/** The tool a layer cuts with: its own bit when known, the active bit otherwise. */
export function carveLayerTool(
  input: Pick<DesignCarveInput, 'tools' | 'activeTool'>,
  toolId: string | undefined,
): CncTool {
  if (toolId === undefined) return input.activeTool;
  return input.tools.find((tool) => tool.id === toolId) ?? input.activeTool;
}

/** Half tip angle in radians, with the shared 60-degree fallback. */
export function vBitHalfAngleRad(tool: CncTool): number {
  const angle = tool.tipAngleDeg;
  const usable = angle !== undefined && Number.isFinite(angle) && angle > 0 && angle < 180;
  const tipDeg = usable ? angle : FALLBACK_V_TIP_ANGLE_DEG;
  return (tipDeg * Math.PI) / 360;
}

/** Grid dimensions covering the stock at the requested cell size. */
export function carveGrid(stock: CarveStock, mmPerCell: number): CarveGrid {
  const cell = Math.max(MIN_CARVE_CELL_MM, mmPerCell);
  return {
    widthCells: Math.max(1, Math.round(stock.widthMm / cell)),
    heightCells: Math.max(1, Math.round(stock.heightMm / cell)),
    mmPerCell: cell,
    originX: stock.originX,
    originY: stock.originY,
  };
}
