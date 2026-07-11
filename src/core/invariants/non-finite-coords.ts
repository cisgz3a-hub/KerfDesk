// Last-line-of-defense scan for non-finite motion coordinates in emitted
// G-code. GrblStrategy's `fmt` is a bare `Number.prototype.toFixed(3)`, which
// renders a non-finite input as the literal text "NaN", "Infinity", or
// "-Infinity". None of those match the digit-only GCODE_NUMBER pattern, so
// `parseGcodeWord` returns null and the bounds scanner silently SKIPS the axis
// (an absent word and a malformed word are indistinguishable to it) — approving
// `G1 XNaN ...` as safe-to-write, which then faults GRBL mid-job. This scanner
// distinguishes a *malformed present* coordinate word from an *absent* one and
// flags it at the text boundary, catching every producer (kerf, tabs, trace,
// text, offset-fill) regardless of which one emitted the non-finite value.
import { isGcodeMotionCommand, stripGcodeComment } from './gcode-words';
import type { Issue } from './predicates';

// X/Y/Z motion coordinates and I/J arc-centre offsets. Feed (F) and power (S)
// are out of scope: GrblStrategy formats only coordinates through `fmt`, and
// speed is already range-checked (`layerSpeedOutOfRange`). The value alternation
// lists exactly the tokens `toFixed` emits for a non-finite number ("NaN",
// "Infinity", "-Infinity"); the `i` flag also catches lowercase from external
// G-code. Ordered longest-first so "Infinity" wins over a bare "Inf".
const NON_FINITE_COORD =
  /(?:^|[^A-Za-z])([XYZIJ])\s*([+-]?(?:NaN|Infinity|Inf))(?=$|\s|[A-Za-z;])/gi;

export function findNonFiniteCoords(gcode: string): readonly Issue[] {
  const lines = gcode.split('\n');
  const issues: Issue[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const stripped = stripGcodeComment(raw);
    if (!isGcodeMotionCommand(stripped)) continue;
    for (const match of stripped.matchAll(NON_FINITE_COORD)) {
      issues.push({
        lineNumber: i + 1,
        line: raw,
        reason: `${match[1]} coordinate is non-finite: ${match[2]}`,
      });
    }
  }
  return issues;
}
