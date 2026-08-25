import type { RemovalGridResolution } from '../../core/sim/removal-grid';

const RELIEF_3D_DISPLAY_CELLS_ACROSS = 256;
const RELIEF_3D_NOMINAL_CELL_MM = 0.25;
const DISPLAY_BUDGET_REASON = 'display-mesh-cell-budget';
const MM_FORMAT_SCALE = 1_000_000;

/** Viewer-owned sampling metadata shared by the Relief 3D scene and removal grid. */
export type Relief3DDisplayResolution = RemovalGridResolution;

/** Viewer-owned display sampling policy; unrelated to source or CAM resolution. */
export function relief3dDisplayResolution(
  widthMm: number,
  heightMm: number,
): Relief3DDisplayResolution {
  const effectiveMmPerCell = Math.max(
    RELIEF_3D_NOMINAL_CELL_MM,
    Math.max(widthMm, heightMm) / RELIEF_3D_DISPLAY_CELLS_ACROSS,
  );
  return {
    requestedMmPerCell: RELIEF_3D_NOMINAL_CELL_MM,
    effectiveMmPerCell,
    reason: effectiveMmPerCell === RELIEF_3D_NOMINAL_CELL_MM ? null : DISPLAY_BUDGET_REASON,
  };
}

/** Nonblocking disclosure when the display mesh budget adjusts the nominal target. */
export function relief3dDisplayResolutionNotice(
  resolution: Relief3DDisplayResolution,
): string | undefined {
  if (resolution.reason === null) return undefined;
  return `Relief 3D preview uses ${formatMm(resolution.effectiveMmPerCell)} mm display cells (${formatMm(resolution.requestedMmPerCell)} mm nominal target) to stay within the ${RELIEF_3D_DISPLAY_CELLS_ACROSS}-cell display mesh budget. Preview only; CAM and G-code are unchanged.`;
}

function formatMm(value: number): string {
  const scaled = value * MM_FORMAT_SCALE;
  if (!Number.isFinite(scaled)) return value.toString();
  return (Math.round(scaled) / MM_FORMAT_SCALE).toString();
}
