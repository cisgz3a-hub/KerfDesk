// The laser tab spans a project's emitted G-code burns: the midpoints of the
// G1 moves at the lowest power the program burns at, which is the tab power
// whenever tabs burn at a reduced power. Machine coordinates, as emitted.

import type { Project, Vec2 } from '../core/scene';
import { emitGcode } from '../io/gcode/emit-gcode';

type Burn = { readonly from: Vec2; readonly to: Vec2; readonly s: number };

export function burnedTabSpans(project: Project): ReadonlyArray<Vec2> {
  const burns = burnedMoves(emitGcode(project).gcode);
  if (burns.length === 0) throw new Error('no burned moves in the G-code');
  const tabPower = Math.min(...burns.map((burn) => burn.s));
  return burns
    .filter((burn) => burn.s === tabPower)
    .map((burn) => ({ x: (burn.from.x + burn.to.x) / 2, y: (burn.from.y + burn.to.y) / 2 }));
}

function burnedMoves(gcode: string): ReadonlyArray<Burn> {
  const burns: Burn[] = [];
  let at: Vec2 | null = null;
  let s = 0;
  for (const line of gcode.split('\n')) {
    const move = /^G([01])\b/.exec(line.trim());
    if (move === null) continue;
    s = word(line, 'S') ?? s;
    const next = movedTo(line, at);
    if (move[1] === '1' && at !== null && s > 0) burns.push({ from: at, to: next, s });
    at = next;
  }
  return burns;
}

// A move names only the axes it changes.
function movedTo(line: string, at: Vec2 | null): Vec2 {
  return { x: word(line, 'X') ?? at?.x ?? 0, y: word(line, 'Y') ?? at?.y ?? 0 };
}

function word(line: string, letter: 'X' | 'Y' | 'S'): number | undefined {
  const value = new RegExp(`${letter}(-?[\\d.]+)`).exec(line)?.[1];
  return value === undefined ? undefined : Number(value);
}
