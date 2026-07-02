// zPassDepths — expand a total cut depth into per-pass Z levels.
//
// CNC bits remove a limited depth of material per pass; the compiler repeats
// each XY toolpath at successively deeper Z until it reaches the target.
// Returns NEGATIVE z values (Z0 = stock top), ordered shallow → deep, with the
// final pass landing exactly on -depthMm so the floor is precise regardless of
// how the division rounds.

const DEPTH_EPS = 1e-9;

export function zPassDepths(depthMm: number, depthPerPassMm: number): ReadonlyArray<number> {
  if (!Number.isFinite(depthMm) || depthMm <= 0) return [];
  const perPass =
    Number.isFinite(depthPerPassMm) && depthPerPassMm > 0
      ? Math.min(depthPerPassMm, depthMm)
      : depthMm;
  const count = Math.max(1, Math.ceil(depthMm / perPass - DEPTH_EPS));
  const out: number[] = [];
  for (let i = 1; i <= count; i += 1) {
    out.push(-Math.min(depthMm, i * perPass));
  }
  out[out.length - 1] = -depthMm;
  return out;
}
