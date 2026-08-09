// zPassDepths — expand a total cut depth into per-pass Z levels.
//
// CNC bits remove a limited depth of material per pass; the compiler repeats
// each XY toolpath at successively deeper Z until it reaches the target.
// Returns NEGATIVE z values (Z0 = stock top), ordered shallow → deep, with the
// final pass landing exactly on -depthMm so the floor is precise regardless of
// how the division rounds.

const DEPTH_EPS = 1e-9;
const MAX_ECMASCRIPT_ARRAY_LENGTH = 0xffff_ffff;

/**
 * Return the factual representation error for a materialized Z-pass Array.
 * ECMAScript ArrayCreate rejects lengths above 2^32 - 1; this is not a job-size
 * policy and does not lower the runtime's own representable limit.
 */
export function zPassArrayMaterializationError(
  depthMm: number,
  depthPerPassMm: number,
): string | null {
  const count = zPassCount(depthMm, depthPerPassMm);
  return count > MAX_ECMASCRIPT_ARRAY_LENGTH
    ? `Z-pass count ${String(count)} exceeds the ECMAScript Array length limit.`
    : null;
}

export function zPassDepths(depthMm: number, depthPerPassMm: number): ReadonlyArray<number> {
  const count = zPassCount(depthMm, depthPerPassMm);
  if (count === 0) return [];
  const perPass =
    Number.isFinite(depthPerPassMm) && depthPerPassMm > 0
      ? Math.min(depthPerPassMm, depthMm)
      : depthMm;
  const out: number[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(-Math.min(depthMm, i * perPass));
  }
  out[out.length - 1] = -depthMm;
  return out;
}

function zPassCount(depthMm: number, depthPerPassMm: number): number {
  if (!Number.isFinite(depthMm) || depthMm <= 0) return 0;
  const perPass =
    Number.isFinite(depthPerPassMm) && depthPerPassMm > 0
      ? Math.min(depthPerPassMm, depthMm)
      : depthMm;
  return Math.max(1, Math.ceil(depthMm / perPass - DEPTH_EPS));
}
