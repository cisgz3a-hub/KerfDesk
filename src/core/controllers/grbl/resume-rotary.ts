// Start from line on a program that turns a dedicated A or Z rotary (ADR-695
// Amendment 1, rolling audit v13 Y5-P1-2). Such a program opens with
// `G92 A0` (or `Z0`) at the turn the part was at, and every later A word counts
// from there. The resume used to re-enter at the head's X only: the first
// replayed stroke burned from wherever the part had stopped, and on firmware
// whose reset clears G92 (stock GRBL, FluidNC) every remaining line counted
// from machine zero instead. The preamble now turns the part back to the job's
// zero in machine coordinates, zeroes it again, and moves to the line's turn,
// all with the beam off. Without the job's zero turn the resume is refused.

export type ResumeRotaryZero = { readonly axis: 'A' | 'Z'; readonly machine: number };

export type RotaryReentry =
  | { readonly kind: 'ok'; readonly preamble: ReadonlyArray<string> }
  | { readonly kind: 'error'; readonly reason: string };

const OPENING_RE = /^G92\s*([AZ])\s*0(?:\.0*)?$/i;

/** The dedicated axis a program turns, from its opening `G92 A0`, or null. */
export function programRotaryAxis(lines: ReadonlyArray<string>): 'A' | 'Z' | null {
  for (const raw of lines) {
    const line = codeOf(raw);
    if (line === '' || line === '%') continue;
    const match = OPENING_RE.exec(line);
    return match === null ? null : (match[1]?.toUpperCase() as 'A' | 'Z');
  }
  return null;
}

/** The preamble with the rotary's re-entry inserted after its beam-off `M5`. */
export function withRotaryReentry(
  preamble: ReadonlyArray<string>,
  lines: ReadonlyArray<string>,
  fromLine: number,
  zero: ResumeRotaryZero | undefined,
): RotaryReentry {
  const axis = programRotaryAxis(lines);
  if (axis === null) return { kind: 'ok', preamble };
  if (zero === undefined || zero.axis !== axis || !Number.isFinite(zero.machine)) {
    return { kind: 'error', reason: rotaryResumeRefusal(axis) };
  }
  const turn = turnBefore(lines, fromLine, axis);
  const reentry = [
    `G53 G0 ${axis}${formatTurn(zero.machine)}`,
    `G92 ${axis}0`,
    ...(turn === null ? [] : [`G0 ${axis}${formatTurn(turn)} S0`]),
  ];
  const beamOff = preamble.indexOf('M5');
  const at = beamOff === -1 ? preamble.length : beamOff + 1;
  return { kind: 'ok', preamble: [...preamble.slice(0, at), ...reentry, ...preamble.slice(at)] };
}

export function rotaryResumeRefusal(axis: 'A' | 'Z'): string {
  return (
    `This program turns a rotary on its ${axis} axis, and KerfDesk does not know the turn the ` +
    'job started from, so a restart would burn from wherever the part is now. KerfDesk keeps ' +
    'that turn when you stop a job with ABORT JOB; after a lost link or a restart it is gone. ' +
    'Run the job again from its start.'
  );
}

// The last turn the program commanded before `fromLine`, its opening G92 aside.
function turnBefore(
  lines: ReadonlyArray<string>,
  fromLine: number,
  axis: 'A' | 'Z',
): number | null {
  const word = new RegExp(`${axis}(-?\\d+(?:\\.\\d+)?)`, 'i');
  let turn: number | null = null;
  for (const raw of lines.slice(0, fromLine - 1)) {
    const line = codeOf(raw);
    if (/^G92\b/i.test(line)) continue;
    const match = word.exec(line);
    if (match !== null) turn = Number(match[1]);
  }
  return turn;
}

function codeOf(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .trim();
}

function formatTurn(value: number): string {
  return value.toFixed(3);
}
