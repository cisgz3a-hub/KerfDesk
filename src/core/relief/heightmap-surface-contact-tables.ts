// Per-cutter tables and supporting lines for the exact surface contact
// (ADR-412): the bounds heightmap-surface-contact.ts prunes elements with
// before any triangle is solved.

// Radial step of the left secant that stands in for the cutter law's slope.
const SECANT_MM = 1e-6;

// Element (cx + di, cy + dj) spans [di, di + 1] x [dj, dj + 1] cells from the
// center on a regular grid, so its nearest-approach cutter height is a table.
export function regularNearDzTable(
  mmPerCell: number,
  span: number,
  radiusMm: number,
  dz: (radiusMm: number) => number,
): Float64Array {
  const side = 2 * span + 2;
  const table = new Float64Array(side * side);
  for (let row = 0; row < side; row += 1) {
    const dy = axisGapMm(row - span - 1, mmPerCell);
    for (let col = 0; col < side; col += 1) {
      const distance = Math.hypot(axisGapMm(col - span - 1, mmPerCell), dy);
      table[row * side + col] = distance > radiusMm ? Number.POSITIVE_INFINITY : dz(distance);
    }
  }
  return table;
}

function axisGapMm(offset: number, mmPerCell: number): number {
  if (offset > 0) return offset * mmPerCell;
  return offset + 1 < 0 ? -(offset + 1) * mmPerCell : 0;
}

export function regularSupportTables(
  mmPerCell: number,
  span: number,
  radiusMm: number,
  dz: (radiusMm: number) => number,
): { readonly regularSupportBase: Float64Array; readonly regularSupportSlopes: Float64Array } {
  const side = 2 * span + 2;
  const base = new Float64Array(side * side).fill(Number.POSITIVE_INFINITY);
  const slopes = new Float64Array(side * side * 4);
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const di = col - span - 1;
      const dj = row - span - 1;
      const rho = Math.hypot(axisGapMm(di, mmPerCell), axisGapMm(dj, mmPerCell));
      const line = supportingLine(
        dz,
        rho,
        radiusMm,
        (di + 0.5) * mmPerCell,
        (dj + 0.5) * mmPerCell,
      );
      if (line === null) continue;
      const index = row * side + col;
      base[index] = line.base;
      const x0 = di * mmPerCell;
      const y0 = dj * mmPerCell;
      slopes[index * 4] = line.gx * x0 + line.gy * y0;
      slopes[index * 4 + 1] = line.gx * (x0 + mmPerCell) + line.gy * y0;
      slopes[index * 4 + 2] = line.gx * x0 + line.gy * (y0 + mmPerCell);
      slopes[index * 4 + 3] = line.gx * (x0 + mmPerCell) + line.gy * (y0 + mmPerCell);
    }
  }
  return { regularSupportBase: base, regularSupportSlopes: slopes };
}

// The supporting line of the cutter law at the element's nearest approach
// rho, pointed at the element's middle (mx, my) relative to the axis: slope
// vector (gx, gy) and constant g rho - dz(rho). Null when it gives no bound.
export function supportingLine(
  dz: (radiusMm: number) => number,
  rho: number,
  radiusMm: number,
  mx: number,
  my: number,
): { readonly gx: number; readonly gy: number; readonly base: number } | null {
  if (!(rho > SECANT_MM) || rho > radiusMm) return null;
  const near = dz(rho);
  const g = (near - dz(rho - SECANT_MM)) / SECANT_MM;
  const length = Math.hypot(mx, my);
  if (!(g > 0) || !Number.isFinite(g) || !(length > 0)) return null;
  return { gx: (g * mx) / length, gy: (g * my) / length, base: g * rho - near };
}
