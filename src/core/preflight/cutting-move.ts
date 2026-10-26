// A program cuts when it feeds: a G1 line or a G2/G3 arc. Leading zeros and
// zero-only fractional parts (`G01`, `G2.0`) name the same command. Preflight's
// empty-output rule and the per-bit tile split (ADR-392 Amendment 2) share
// this test, so a pass that opens with an arc is never treated as a file that
// cuts nothing.
// Not part of a longer word (`MSG1`), nor `G10`/`G1.5`; packed words count.
// Tool and layer labels may mention motion words inside inert comments.
import { iterateGcodeLines, stripGcodeComment } from '../invariants/gcode-words';

const CUTTING_MOVE = /(?<![A-Z])G0*[123](?:\.0*)?(?![\d.])/i;

export function hasCuttingMove(gcode: string): boolean {
  for (const line of iterateGcodeLines(gcode)) {
    if (CUTTING_MOVE.test(stripGcodeComment(line))) return true;
  }
  return false;
}
