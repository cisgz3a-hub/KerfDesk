// Scans SVG path data into commands for parsePathD, stopping at the first
// error as SVG 2 requires: render the path "up to (but not including) the path
// command containing the first error" (paths.html, error handling; A-17). The
// data must open with a moveto, and an unknown character or an argument tuple
// that cannot be completed ends the path before that command. A command's
// repeated tuples count as repeated commands, so the complete ones before an
// error still draw. Separators stay as lenient as browsers': whitespace and a
// comma between numbers, left out wherever that is unambiguous ("1.5.5",
// "10-5", and the fused arc flags of "a4 4 0 011 7").

export type PathToken = { readonly cmd: string; readonly args: ReadonlyArray<number> };

// Numbers per repetition of each command; closepath takes none.
const ARITY: Readonly<Record<string, number>> = {
  M: 2,
  m: 2,
  L: 2,
  l: 2,
  H: 1,
  h: 1,
  V: 1,
  v: 1,
  C: 6,
  c: 6,
  S: 4,
  s: 4,
  Q: 4,
  q: 4,
  T: 2,
  t: 2,
  A: 7,
  a: 7,
  Z: 0,
  z: 0,
};

type ArgumentScan = { readonly args: number[]; readonly end: number; readonly failed: boolean };

export function tokenizePathData(d: string): ReadonlyArray<PathToken> {
  // Local (not module-level) because sticky regexes carry mutable lastIndex.
  const numberAt = /[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
  const tokens: PathToken[] = [];
  let i = skipWhitespace(d, 0);
  while (i < d.length) {
    const cmd = d[i] ?? '';
    const arity = ARITY[cmd];
    if (arity === undefined || (tokens.length === 0 && cmd !== 'M' && cmd !== 'm')) break;
    const scan = scanArguments(d, i + 1, { cmd, arity, numberAt });
    if (scan.args.length > 0 || arity === 0) tokens.push({ cmd, args: scan.args });
    if (scan.failed) break;
    i = scan.end;
  }
  return tokens;
}

type Command = { readonly cmd: string; readonly arity: number; readonly numberAt: RegExp };

// Reads a command's tuples up to the next command letter or the end of the
// data. On an error it keeps only the tuples completed before it.
function scanArguments(d: string, start: number, command: Command): ArgumentScan {
  const args: number[] = [];
  let i = skipWhitespace(d, start);
  for (;;) {
    const slot = command.arity === 0 ? 0 : args.length % command.arity;
    if (slot === 0 && (i >= d.length || ARITY[d[i] ?? ''] !== undefined)) {
      // Every command but closepath needs at least one tuple.
      return { args, end: i, failed: command.arity > 0 && args.length === 0 };
    }
    const value = command.arity === 0 ? null : readArgument(d, i, command, slot);
    if (value === null) return { args: args.slice(0, args.length - slot), end: i, failed: true };
    args.push(value.number);
    i = skipCommaWhitespace(d, value.end);
  }
}

// The arc flags (tuple slots 3 and 4) are single '0'/'1' characters that need
// no separator; every other slot is a full number. H8: `a4 4 0 011 7` is valid
// SVG and standard SVGO output, which a greedy number match reads as `011`.
function readArgument(
  d: string,
  at: number,
  command: Command,
  slot: number,
): { readonly number: number; readonly end: number } | null {
  if ((command.cmd === 'A' || command.cmd === 'a') && (slot === 3 || slot === 4)) {
    const flag = d[at];
    return flag === '0' || flag === '1' ? { number: Number(flag), end: at + 1 } : null;
  }
  command.numberAt.lastIndex = at;
  const match = command.numberAt.exec(d);
  return match === null
    ? null
    : { number: finiteNumber(match[0]), end: command.numberAt.lastIndex };
}

// A path coordinate must be finite. The number grammar permits an unbounded
// exponent, so `Number("1e999")` is Infinity; a non-finite coordinate would flow
// to the G-code emitter as a literal `XInfinity`/`XNaN` word and slip past the
// out-of-bounds preflight, which cannot parse a non-numeric coordinate (S04-001).
// Reject at the import boundary, mirroring io/project's `requireCoordinate`
// finiteness guard on `.lf2` load. This is an INTEGRITY refusal, not a policy
// cap: it survived ADR-268, which removed the point/polyline/color-group
// ceilings this parser used to throw on alongside it.
function finiteNumber(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`SVG path contains a non-finite coordinate: "${raw}"`);
  }
  return value;
}

function skipWhitespace(d: string, from: number): number {
  let i = from;
  while (isWhitespace(d[i])) i += 1;
  return i;
}

function skipCommaWhitespace(d: string, from: number): number {
  const i = skipWhitespace(d, from);
  return d[i] === ',' ? skipWhitespace(d, i + 1) : i;
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}
