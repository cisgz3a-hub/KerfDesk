// Heightmap — the carveable surface of a relief (Phase H.4, ADR-098).
// Row-major Float32 depths in mm: 0 = stock top, negative = into the stock,
// floor = −reliefDepthMm. Produced by mesh-to-heightmap, consumed by the
// canvas preview (H.4) and the roughing/finishing toolpath generators
// (H.5/H.8).

export type Heightmap = {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly mmPerCell: number;
  // length = widthCells * heightCells; values in [−reliefDepthMm, 0].
  readonly depth: Float32Array;
};

export const DEFAULT_HEIGHTMAP_CELL_MM = 0.2;
// ~4M cells ≈ 16 MB — larger requests coarsen automatically.
export const MAX_HEIGHTMAP_CELLS = 4_000_000;

export type HeightmapCellSizeResult =
  | { readonly kind: 'ok'; readonly mmPerCell: number }
  | { readonly kind: 'error'; readonly reason: string };

export function heightmapCellSize(
  widthMm: number,
  heightMm: number,
  requested: number,
): HeightmapCellSizeResult {
  const widthError = validateFinitePositive('Heightmap width', widthMm);
  if (widthError !== null) return widthError;
  const heightError = validateFinitePositive('Heightmap height', heightMm);
  if (heightError !== null) return heightError;
  const requestedError = validateFinitePositive('Heightmap cell size', requested);
  if (requestedError !== null) return requestedError;
  const safe = Math.max(1e-3, requested);
  const cells = Math.ceil(widthMm / safe) * Math.ceil(heightMm / safe);
  if (Number.isFinite(cells) && cells <= MAX_HEIGHTMAP_CELLS) {
    return { kind: 'ok', mmPerCell: safe };
  }
  const area = widthMm * heightMm;
  if (!Number.isFinite(area)) {
    return { kind: 'error', reason: 'Heightmap dimensions exceed numeric limits.' };
  }
  const mmPerCell = Math.sqrt(area / MAX_HEIGHTMAP_CELLS);
  return Number.isFinite(mmPerCell) && mmPerCell > 0
    ? { kind: 'ok', mmPerCell }
    : { kind: 'error', reason: 'Heightmap dimensions exceed numeric limits.' };
}

export function heightmapDepthAt(map: Heightmap, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= map.widthCells || cy >= map.heightCells) return 0;
  return map.depth[cy * map.widthCells + cx] ?? 0;
}

function validateFinitePositive(
  label: string,
  value: number,
): { readonly kind: 'error'; readonly reason: string } | null {
  return Number.isFinite(value) && value > 0
    ? null
    : { kind: 'error', reason: `${label} must be a finite positive number.` };
}
