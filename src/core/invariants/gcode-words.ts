const GCODE_NUMBER = String.raw`[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?`;
const WORD_BOUNDARY_AFTER_NUMBER = String.raw`(?=$|\s|[A-DF-Za-df-z])`;

export function parseGcodeWord(line: string, word: string): number | null {
  const match = new RegExp(
    String.raw`(?:^|[^A-Za-z])${escapeRegExp(word)}(${GCODE_NUMBER})${WORD_BOUNDARY_AFTER_NUMBER}`,
    'i',
  ).exec(line);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function isGcodeCommand(line: string, command: string): boolean {
  return new RegExp(String.raw`^${escapeRegExp(command)}(?=$|\s|[A-Za-z])`, 'i').test(line);
}

export function isGcodeMotionCommand(line: string): boolean {
  return /^G[0123](?=$|\s|[A-Za-z])/i.test(line);
}

// G2 (clockwise) / G3 (counter-clockwise) circular interpolation. Matches the
// single-digit form the emitter writes, consistent with isGcodeMotionCommand.
export function isArcMotion(line: string): boolean {
  return /^G[23](?=$|\s|[A-Za-z])/i.test(line);
}

export function isClockwiseArc(line: string): boolean {
  return /^G2(?=$|\s|[A-Za-z])/i.test(line);
}

// A single materialized G-code body is scanned by several independent
// invariant predicates in one preflight pass. Splitting the whole string per
// predicate re-allocates a line array of the entire (up to ~96 MB) output each
// time — the redundant-materialization half of the raster-preflight freeze
// (A8). Predicates accept the already-split lines so the caller splits ONCE
// and threads the array through every scan; a bare string still works for the
// property tests and external callers.
export function asGcodeLines(gcode: string | ReadonlyArray<string>): ReadonlyArray<string> {
  return typeof gcode === 'string' ? gcode.split('\n') : gcode;
}

export function stripGcodeComment(line: string): string {
  const semi = line.indexOf(';');
  const head = semi >= 0 ? line.slice(0, semi) : line;
  return head
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\(.*/, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
