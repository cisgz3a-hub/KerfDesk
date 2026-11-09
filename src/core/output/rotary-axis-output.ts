// rotary-axis-output — write a rotary's turn under its dedicated axis
// (ADR-695). Every laser emitter writes the machine-space job's Y slot as `Y`;
// on an A or Z rotary that slot is the part's turn, so this stage renames each
// Y word in the finished lines to the axis letter. The head's Y is then never
// commanded: it stays over the part where the operator put it, as LightBurn's
// A-axis output does. Comments are left exactly as they were.
//
// Each Frame and job first declares the part's current turn as zero with
// `G92 A0` (or `G92 Z0`). G92 sets only the axes it names, so X and Y keep
// their work offsets. Nothing reports where a dedicated rotary stands, so this
// is the only truthful start: the machine-space job puts its anchor (or, for
// Absolute, its lowest edge) at 0.

import type { DedicatedRotaryAxis } from '../devices/rotary';

/** The line that makes the part's current turn the axis's zero. */
export function rotaryAxisZeroLine(axis: DedicatedRotaryAxis): string {
  return `G92 ${axis}0`;
}

export type RotaryAxisRouting =
  | { readonly kind: 'ok'; readonly text: string }
  | {
      readonly kind: 'conflict';
      /** 1-based line number in the routed text. */
      readonly lineNumber: number;
      readonly line: string;
    };

/**
 * Renames every Y word to `axis` in each line's code (never in a comment).
 * A line that already carries an `axis` word is a conflict: the program uses
 * that letter for something else, so its turn could not be told apart.
 */
export function routeRotaryAxisLines(text: string, axis: DedicatedRotaryAxis): RotaryAxisRouting {
  const lines = text.split('\n');
  const routed: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const next = routeRotaryAxisLine(line, axis);
    if (next === null) return { kind: 'conflict', lineNumber: index + 1, line };
    routed.push(next);
  }
  return { kind: 'ok', text: routed.join('\n') };
}

/** One line renamed, or null when it already uses the axis letter. */
export function routeRotaryAxisLine(line: string, axis: DedicatedRotaryAxis): string | null {
  let out = '';
  let inParenComment = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? '';
    if (inParenComment) {
      out += char;
      if (char === ')') inParenComment = false;
      continue;
    }
    if (char === ';') return out + line.slice(i);
    if (char === '(') {
      inParenComment = true;
      out += char;
      continue;
    }
    const word = char.toUpperCase();
    if ((word === 'Y' || word === axis) && startsNumber(line, i + 1)) {
      if (word === axis) return null;
      out += axis;
      continue;
    }
    out += char;
  }
  return out;
}

function startsNumber(line: string, index: number): boolean {
  let i = index;
  while (line[i] === ' ') i += 1;
  const char = line[i];
  return char !== undefined && /[-+.\d]/.test(char);
}
