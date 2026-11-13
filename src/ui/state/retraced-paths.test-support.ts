// An independent reader of emitted G-code for the retraced-path regressions
// (tools audit T1, T30-P1-2 / T30R-P2-1, ADR-486 Amendment 4): every lit move
// in scene coordinates. It reads G-code words only, so it shares none of the
// planner's geometry, and it reports Job Review's compile warnings beside it.

import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { Project, Vec2 } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { compileDiagnosticWarnings } from '../laser/compile-diagnostic-warnings';

export type LitSegment = { readonly from: Vec2; readonly to: Vec2; readonly length: number };

type Machine = { x: number; y: number; s: number; g: number; on: boolean; relative: boolean };

function wordsOf(raw: string): ReadonlyArray<readonly [string, number]> {
  const line = raw
    .replace(/;.*$/, '')
    .replace(/\(.*?\)/g, '')
    .toUpperCase();
  return [...line.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)/g)].map(
    ([, letter, value]) => [letter ?? '', Number(value)] as const,
  );
}

const MODE_WORDS: Readonly<Record<string, (machine: Machine, value: number) => void>> = {
  G: (machine, value) => {
    if (value >= 0 && value <= 3) machine.g = value;
    if (value === 90 || value === 91) machine.relative = value === 91;
  },
  M: (machine, value) => {
    if (value === 3 || value === 4 || value === 5) machine.on = value !== 5;
  },
  S: (machine, value) => {
    machine.s = value;
  },
};

function setMode(machine: Machine, letter: string, value: number): void {
  MODE_WORDS[letter]?.(machine, value);
}

function step(machine: Machine, words: ReadonlyArray<readonly [string, number]>): Vec2 | null {
  const target = { x: machine.x, y: machine.y };
  let moved = false;
  for (const [letter, value] of words) {
    setMode(machine, letter, value);
    if (letter !== 'X' && letter !== 'Y') continue;
    const axis = letter === 'X' ? 'x' : 'y';
    target[axis] = machine.relative ? machine[axis] + value : value;
    moved = true;
  }
  return moved ? target : null;
}

/** Lit feed moves (arcs as chords), in scene millimetres. */
export function litSegments(gcode: string, device: DeviceProfile): ReadonlyArray<LitSegment> {
  const machine: Machine = { x: 0, y: 0, s: 0, g: 0, on: false, relative: false };
  const segments: LitSegment[] = [];
  for (const raw of gcode.split('\n')) {
    const target = step(machine, wordsOf(raw));
    if (target === null) continue;
    if (machine.g !== 0 && machine.on && machine.s > 0) {
      const from = toSceneCoords({ x: machine.x, y: machine.y }, device);
      const to = toSceneCoords(target, device);
      segments.push({ from, to, length: Math.hypot(to.x - from.x, to.y - from.y) });
    }
    machine.x = target.x;
    machine.y = target.y;
  }
  return segments;
}

export type Burn = {
  /** Lit length with both ends inside the box. */
  readonly inside: (box: Box) => number;
  readonly total: number;
  /** Job Review's compile warnings. */
  readonly warnings: ReadonlyArray<string>;
};

export type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function burnOf(project: Project): Burn {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('output failed');
  const segments = litSegments(emitPreparedGcode(prepared).gcode, project.device);
  const within = (box: Box, p: Vec2) =>
    p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY;
  return {
    inside: (box) =>
      segments
        .filter((segment) => within(box, segment.from) && within(box, segment.to))
        .reduce((sum, segment) => sum + segment.length, 0),
    total: segments.reduce((sum, segment) => sum + segment.length, 0),
    warnings: compileDiagnosticWarnings(prepared.job),
  };
}
