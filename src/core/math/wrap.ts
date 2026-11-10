// Wrap-around arithmetic shared by core, io and ui (code quality audit C1,
// C2-P3-1). Every copy replaced by an import had the same body.

/** The angle brought into [0, 360). */
export function normalizeDegrees(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/** The remainder that is never negative for a positive `size`. */
export function modulo(value: number, size: number): number {
  return ((value % size) + size) % size;
}
