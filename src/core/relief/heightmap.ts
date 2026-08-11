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
  // Optional binary material domain. 1 = included, 0 = deliberately omitted.
  // Absent means every cell is included (legacy mesh and unmasked fields).
  readonly inclusion?: Uint8Array;
};

export const DEFAULT_HEIGHTMAP_CELL_MM = 0.2;
// ~4M Float32 cells ≈ 16 MB. This is advisory metadata for previews and
// warnings only; it must never rewrite or refuse an operator's requested
// physical cell size.
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
  return { kind: 'ok', mmPerCell: requested };
}

export function heightmapDepthAt(map: Heightmap, cx: number, cy: number): number {
  if (cx < 0 || cy < 0 || cx >= map.widthCells || cy >= map.heightCells) return 0;
  const index = cy * map.widthCells + cx;
  return map.inclusion?.[index] === 0 ? 0 : (map.depth[index] ?? 0);
}

function validateFinitePositive(
  label: string,
  value: number,
): { readonly kind: 'error'; readonly reason: string } | null {
  return Number.isFinite(value) && value > 0
    ? null
    : { kind: 'error', reason: `${label} must be a finite positive number.` };
}
