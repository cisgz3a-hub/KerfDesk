// evaluated-syntax — lines FluidNC and grblHAL work out as they run (ADR-630
// Amendment 5, controller audit v4 E4-P2-2). FluidNC reads a word's value from
// a `#` parameter (`X#1`, `X#<width>`, `X##2`) or a bracketed expression
// (`X[5*2]`), takes `#1=120` as an assignment, and hands whatever follows an O
// number to flow control (`O100 if [...]`, `O100 while [...]`). It removes
// spaces and upper-cases a line first, as the canonical line has no spaces:
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/GCode.cpp#L157-L193
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/GCode.cpp#L313-L328
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Parameters.cpp#L569-L634
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Flowcontrol.cpp#L70-L113
// grblHAL does the same in builds with NGC_EXPRESSIONS_ENABLE and answers an
// error for them in other builds:
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/gcode.c#L1379-L1474
// The Inspector reads none of it, so the Frame would trace another path than
// the one that runs. Stock GRBL rejects such a line, which its review already
// shows (grbl-block-rejection.ts), so only these two refuse.

import type { ControllerKind } from '../devices';

/** An O number followed by more of the line, which goes to flow control. */
const FLOW_CONTROL = /O(?:\d+(?:\.\d*)?|<[^>]*>)[A-Z]/i;

const RUNS_IT: Partial<Record<ControllerKind, string>> = {
  fluidnc: 'FluidNC works out as the program runs',
  grblhal:
    'grblHAL works out as the program runs in builds with expressions, and answers with an error in others',
};

/** Why this canonical line cannot be framed on `kind`, or null. */
export function evaluatedSyntaxRefusal(
  line: string,
  kind: ControllerKind | undefined,
): string | null {
  const runsIt = kind === undefined ? undefined : RUNS_IT[kind];
  if (runsIt === undefined) return null;
  const syntax = evaluatedSyntaxOf(line);
  if (syntax === null) return null;
  return `uses ${syntax}, which ${runsIt}. KerfDesk cannot work it out, so the Frame would not trace the path that runs. Save the program with plain numbers.`;
}

function evaluatedSyntaxOf(line: string): string | null {
  if (line.includes('#')) return 'a # parameter';
  if (line.includes('[')) return 'a [ ] expression';
  return FLOW_CONTROL.test(line) ? 'O-word flow control' : null;
}
