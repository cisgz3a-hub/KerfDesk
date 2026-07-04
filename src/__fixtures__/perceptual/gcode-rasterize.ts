// Perceptual test harness - emitted G-code burn rasterizer.
//
// Parses deterministic GRBL output back into a binary mask from the outside of
// the emitter. The source-mask tests can then compare "what the controller text
// asks the laser to burn" against the original closed contours. It intentionally
// ignores rapid/travel moves and only inks G1 motion while M3/M4 is armed with a
// positive modal S value.

import { parseGcodeWord, stripGcodeComment } from '../../core/invariants';
import type { Vec2 } from '../../core/scene';
import { createMask, type Mask } from './rasterize';
import { rasterizeBurnSegment } from './toolpath-rasterize';

export type GcodeRasterizeOptions = {
  readonly burnWidthMm?: number;
};

const DEFAULT_BURN_WIDTH_MM = 1;
const RASTERIZED_WORDS = ['G', 'M', 'S', 'X', 'Y'] as const;

type ParserState = {
  position: Vec2;
  motion: 'G0' | 'G1';
  armed: boolean;
  s: number;
};

export function rasterizeGcodeBurn(
  gcode: string,
  width: number,
  height: number,
  options: GcodeRasterizeOptions = {},
): Mask {
  const mask = createMask(width, height);
  const state: ParserState = {
    position: { x: 0, y: 0 },
    motion: 'G0',
    armed: false,
    s: 0,
  };
  for (const rawLine of gcode.split('\n')) {
    applyLine(mask, state, rawLine, options.burnWidthMm ?? DEFAULT_BURN_WIDTH_MM);
  }
  return mask;
}

function applyLine(mask: Mask, state: ParserState, rawLine: string, burnWidthMm: number): void {
  const words = parseWords(stripGcodeComment(rawLine));
  if (words.size === 0) return;
  applyLaserState(state, words);
  applyMotionMode(state, words);
  const next = nextPosition(state.position, words);
  if (next === null) return;
  if (isLaserOnMove(state)) {
    rasterizeBurnSegment(mask, state.position, next, burnWidthMm);
  }
  state.position = next;
}

function applyLaserState(state: ParserState, words: ReadonlyMap<string, number>): void {
  const m = words.get('M');
  switch (m) {
    case 3:
    case 4:
      state.armed = true;
      break;
    case 5:
      state.armed = false;
      state.s = 0;
      break;
    case undefined:
      break;
    default:
      break;
  }
  const nextS = words.get('S');
  if (nextS !== undefined) state.s = nextS;
}

function applyMotionMode(state: ParserState, words: ReadonlyMap<string, number>): void {
  const g = words.get('G');
  if (g === 0) state.motion = 'G0';
  if (g === 1) state.motion = 'G1';
}

function nextPosition(position: Vec2, words: ReadonlyMap<string, number>): Vec2 | null {
  const x = words.get('X');
  const y = words.get('Y');
  if (x === undefined && y === undefined) return null;
  return { x: x ?? position.x, y: y ?? position.y };
}

function isLaserOnMove(state: ParserState): boolean {
  return state.motion === 'G1' && state.armed && state.s > 0;
}

function parseWords(line: string): Map<string, number> {
  const words = new Map<string, number>();
  for (const word of RASTERIZED_WORDS) {
    const value = parseGcodeWord(line, word);
    if (value !== null) words.set(word, value);
  }
  return words;
}
