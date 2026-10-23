// A program cuts when it feeds: a G1 line or a G2/G3 arc, in any spelling the
// controller reads as that word (`G01`, `G2`). Preflight's empty-output rule
// and the per-bit tile split (ADR-392 Amendment 2) share this test, so a pass
// that opens with an arc is never treated as a file that cuts nothing.
// Not part of a longer word (`MSG1`), nor `G10`/`G1.5`; packed words count.
const CUTTING_MOVE = /(?<![A-Z])G0*[123](?![\d.])/i;

export function hasCuttingMove(gcode: string): boolean {
  return CUTTING_MOVE.test(gcode);
}
