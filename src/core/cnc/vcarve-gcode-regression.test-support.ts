import { scanGcodeWords } from '../gcode';
import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';

const GRBL_PLANNER_BLOCKS = 16;
const GRBL_BAUD = 115_200;
const SERIAL_BITS_PER_BYTE = 10;
const SECONDS_PER_MINUTE = 60;

type CuttingBlock = {
  readonly episode: number;
  readonly lineNumber: number;
  readonly motionSeconds: number;
  readonly wireSeconds: number;
};

type MotionState = {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
  readonly feed: number | null;
  readonly episode: number;
};

export type GrblPlannerWindow = {
  readonly firstLine: number;
  readonly marginSeconds: number;
  readonly episode: number;
};

export function gcodeCuttingEntryCount(gcode: string): number {
  const rapidXyMoves = gcode.split('\n').filter((line) => /^G0\b.*\b[XY]-?\d/.test(line)).length;
  return Math.max(0, rapidXyMoves - 1);
}

export function worstGrblPlannerWindow(gcode: string): GrblPlannerWindow | null {
  const blocks = cuttingBlocks(gcode);
  let worst: GrblPlannerWindow | null = null;
  for (let start = 0; start + GRBL_PLANNER_BLOCKS <= blocks.length; start += 1) {
    const window = blocks.slice(start, start + GRBL_PLANNER_BLOCKS);
    const first = window[0];
    if (first === undefined || window.some((block) => block.episode !== first.episode)) continue;
    const candidate = {
      firstLine: first.lineNumber,
      episode: first.episode,
      marginSeconds:
        window.reduce((sum, block) => sum + block.motionSeconds, 0) -
        window.reduce((sum, block) => sum + block.wireSeconds, 0),
    };
    if (worst === null || candidate.marginSeconds < worst.marginSeconds) worst = candidate;
  }
  return worst;
}

export function gcodeXyzFeedBlockCount(gcode: string): number {
  let count = 0;
  let motion: GcodeMotionMode | null = 0;
  for (const line of gcode.split('\n')) {
    const scanned = scanModalMotionLine(line, motion);
    motion = scanned.motion;
    if (motion !== 1 || !scanned.hasTarget) continue;
    const letters = new Set(scanGcodeWords(line).map((word) => word.letter));
    if (letters.has('X') && letters.has('Y') && letters.has('Z')) count += 1;
  }
  return count;
}

function cuttingBlocks(gcode: string): ReadonlyArray<CuttingBlock> {
  const blocks: CuttingBlock[] = [];
  let state: MotionState = { x: null, y: null, z: null, feed: null, episode: 0 };
  let motion: GcodeMotionMode | null = 0;
  for (const [index, line] of gcode.split('\n').entries()) {
    const scanned = scanModalMotionLine(line, motion);
    motion = scanned.motion;
    if (!scanned.isMotion || (motion !== 0 && motion !== 1)) continue;
    const next = nextMotionState(line, state, motion === 0);
    const block = cuttingBlockFor(line, index + 1, state, next, motion === 1);
    if (block !== null) blocks.push(block);
    state = next;
  }
  return blocks;
}

function nextMotionState(line: string, state: MotionState, isRapid: boolean): MotionState {
  return {
    x: parseWord(line, 'X') ?? state.x,
    y: parseWord(line, 'Y') ?? state.y,
    z: parseWord(line, 'Z') ?? state.z,
    feed: parseWord(line, 'F') ?? state.feed,
    episode: state.episode + (isRapid ? 1 : 0),
  };
}

function cuttingBlockFor(
  line: string,
  lineNumber: number,
  state: MotionState,
  next: MotionState,
  isFeedMove: boolean,
): CuttingBlock | null {
  if (!isFeedMove || !(['X', 'Y'] as const).some((word) => parseWord(line, word) !== null)) {
    return null;
  }
  if (next.z === null || next.z >= 0 || next.feed === null || next.feed <= 0) return null;
  const coordinates = [state.x, state.y, state.z, next.x, next.y, next.z];
  if (coordinates.some((coordinate) => coordinate === null)) return null;
  const distanceMm = Math.hypot(
    Number(next.x) - Number(state.x),
    Number(next.y) - Number(state.y),
    next.z - Number(state.z),
  );
  return {
    episode: next.episode,
    lineNumber,
    motionSeconds: (distanceMm / next.feed) * SECONDS_PER_MINUTE,
    wireSeconds: ((line.length + 1) * SERIAL_BITS_PER_BYTE) / GRBL_BAUD,
  };
}

function parseWord(line: string, word: 'X' | 'Y' | 'Z' | 'F'): number | null {
  return scanGcodeWords(line).find((match) => match.letter === word)?.value ?? null;
}
