// controller-block-check — the lines a GRBL-family controller rejects as a
// whole block (ADR-630 Amendment 1): two commands from one modal group
// (error:21), two commands that both take the axis words (error:24) and a
// repeated value word (error:25). The Inspector would still apply such a
// line, so the outline it frames would differ from what runs (`G90G91G1X10`
// is framed relative but runs absolute), and Start stops on the error with
// later lines already buffered. Grbl, grblHAL and FluidNC check all three in
// their G-code parsers:
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L117-L330
//
// The coolant group (M7, M8, M9) is left out: firmware differs on M7 with M8,
// and coolant does not move the head.

import { scanGcodeWords } from '../gcode/word-scan';

/** Why the controller rejects this canonical line as a block, or null. */
export function controllerBlockRejection(line: string): string | null {
  const groups = new Map<string, string>();
  const values = new Set<string>();
  let axisCommand: string | null = null;
  for (const word of scanGcodeWords(line)) {
    if (word.letter !== 'G' && word.letter !== 'M') {
      if (values.has(word.letter)) return `it repeats the ${word.letter} word (error:25)`;
      values.add(word.letter);
      continue;
    }
    const code = Math.round(word.value * 10) / 10;
    const name = `${word.letter}${code}`;
    const group = (word.letter === 'G' ? G_GROUPS : M_GROUPS).get(code);
    if (group === undefined) continue;
    const first = groups.get(group);
    if (first !== undefined) return `${first} and ${name} are in one modal group (error:21)`;
    groups.set(group, name);
    if (word.letter === 'G' && takesAxisWords(code)) {
      if (axisCommand !== null)
        return `${axisCommand} and ${name} both take the axis words (error:24)`;
      axisCommand = name;
    }
  }
  return null;
}

// GRBL's modal groups (gcode.h), named as there. Codes outside them are left
// to the controller, which answers error:20 for one it does not support.
const G_GROUPS: ReadonlyMap<number, string> = groupTable({
  G0: [4, 10, 28, 28.1, 30, 30.1, 53, 92, 92.1],
  G1: [0, 1, 2, 3, 38.2, 38.3, 38.4, 38.5, 80],
  G2: [17, 18, 19],
  G3: [90, 91],
  G4: [91.1],
  G5: [93, 94],
  G6: [20, 21],
  G7: [40],
  G8: [43.1, 49],
  G12: [54, 55, 56, 57, 58, 59],
  G13: [61],
});

const M_GROUPS: ReadonlyMap<number, string> = groupTable({
  M4: [0, 1, 2, 30],
  M7: [3, 4, 5],
});

function groupTable(groups: Readonly<Record<string, ReadonlyArray<number>>>): Map<number, string> {
  return new Map(
    Object.entries(groups).flatMap(([group, codes]) => codes.map((code) => [code, group] as const)),
  );
}

// G28.1, G30.1 and G92.1 take no axis words; G53 only changes how a motion
// command reads them.
function takesAxisWords(code: number): boolean {
  return [10, 28, 30, 92, 0, 1, 2, 3, 38.2, 38.3, 38.4, 38.5, 43.1].includes(code);
}
