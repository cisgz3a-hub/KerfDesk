// An independent reader of emitted G-code for the Weld regressions (tools
// audit T1, T28): every lit G1 move in scene coordinates, with its feed. It
// reads words only, so it does not share the planner's geometry.

import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { Project } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';

export type LitMove = { readonly maxX: number; readonly feed: number; readonly length: number };

type Machine = { x: number; y: number; s: number; f: number; g: number; on: boolean };

function wordsOf(raw: string): ReadonlyMap<string, number> {
  const line = raw
    .replace(/;.*$/, '')
    .replace(/\(.*?\)/g, '')
    .toUpperCase();
  const words = new Map<string, number>();
  for (const [, letter, value] of line.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)) {
    if (letter !== undefined) words.set(letter, Number(value));
  }
  return words;
}

function updateModes(machine: Machine, words: ReadonlyMap<string, number>): void {
  const m = words.get('M');
  if (m === 3 || m === 4) machine.on = true;
  if (m === 5) machine.on = false;
  const g = words.get('G');
  if (g !== undefined && g >= 0 && g <= 3) machine.g = g;
  machine.f = words.get('F') ?? machine.f;
  machine.s = words.get('S') ?? machine.s;
}

function isLitFeed(machine: Machine, words: ReadonlyMap<string, number>): boolean {
  return (words.has('X') || words.has('Y')) && machine.g === 1 && machine.on && machine.s > 0;
}

export function litMoves(gcode: string, device: DeviceProfile): ReadonlyArray<LitMove> {
  const machine: Machine = { x: 0, y: 0, s: 0, f: 0, g: 0, on: false };
  const moves: LitMove[] = [];
  for (const raw of gcode.split('\n')) {
    const words = wordsOf(raw);
    updateModes(machine, words);
    const x = words.get('X') ?? machine.x;
    const y = words.get('Y') ?? machine.y;
    if (isLitFeed(machine, words)) {
      const from = toSceneCoords({ x: machine.x, y: machine.y }, device);
      const to = toSceneCoords({ x, y }, device);
      moves.push({
        maxX: Math.max(from.x, to.x),
        feed: machine.f,
        length: Math.hypot(to.x - from.x, to.y - from.y),
      });
    }
    machine.x = x;
    machine.y = y;
  }
  return moves;
}

export function litLength(moves: ReadonlyArray<LitMove>): number {
  return moves.reduce((sum, move) => sum + move.length, 0);
}

/** The lit moves of the project's ordinary output. */
export function burnMoves(project: Project): ReadonlyArray<LitMove> {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('output failed');
  return litMoves(emitPreparedGcode(prepared).gcode, project.device);
}
