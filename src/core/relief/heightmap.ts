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
  if (heightmapFits(widthMm, heightMm, safe)) {
    return { kind: 'ok', mmPerCell: safe };
  }

  // A square-root area estimate is insufficient for highly anisotropic maps:
  // ceil(width / cell) * ceil(height / cell) can remain above the cap, and the
  // estimate can even be smaller than the requested cell size. Keep the
  // requested size as the unsafe lower bound and bisect logarithmically toward
  // a known-safe one-cell-per-axis upper bound. This is deterministic across
  // the full finite-positive input range and can only coarsen resolution.
  let lower = safe;
  let upper = Math.max(widthMm, heightMm, safe);
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const midpoint = Math.exp((Math.log(lower) + Math.log(upper)) / 2);
    if (!(midpoint > lower && midpoint < upper)) break;
    if (heightmapFits(widthMm, heightMm, midpoint)) {
      upper = midpoint;
    } else {
      lower = midpoint;
    }
  }
  return { kind: 'ok', mmPerCell: upper };
}

function heightmapFits(widthMm: number, heightMm: number, mmPerCell: number): boolean {
  // Match meshToHeightmap's allocation law exactly. A subnormal dimension can
  // underflow to zero after division, but downstream still allocates one cell.
  const widthCells = Math.max(1, Math.ceil(widthMm / mmPerCell));
  if (!Number.isFinite(widthCells) || widthCells > MAX_HEIGHTMAP_CELLS) return false;
  const heightCells = Math.max(1, Math.ceil(heightMm / mmPerCell));
  return (
    Number.isFinite(heightCells) && heightCells <= Math.floor(MAX_HEIGHTMAP_CELLS / widthCells)
  );
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
