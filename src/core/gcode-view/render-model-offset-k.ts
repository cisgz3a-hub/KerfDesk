// Whether a line's K is an arc offset (ADR-630 Amendment 2). Split out of
// render-model-words.ts. GRBL (gcode.c) takes an arc's centre from the
// offsets on its plane's two axes, so K is one only in the XZ (G18) and YZ
// (G19) planes; on any other line the Inspector does not interpret it.

type LineModes = {
  readonly motion: number;
  readonly plane: number;
  readonly cycle: unknown;
};

type LineTally = {
  readonly axisWords: Map<string, number>;
  readonly sawHome: boolean;
  sawUnsupported: boolean;
};

/** Keeps K among the axis words of a G18/G19 arc; otherwise counts it unsupported. */
export function settleOffsetK(
  modes: LineModes,
  tally: LineTally,
  line: number,
  countUnsupported: (word: string, line: number) => void,
): void {
  if (!tally.axisWords.has('K')) return;
  const arc = (modes.motion === 2 || modes.motion === 3) && modes.cycle === null;
  if (arc && modes.plane !== 17 && !tally.sawHome) return;
  tally.axisWords.delete('K');
  countUnsupported('K', line);
  tally.sawUnsupported = true;
}
