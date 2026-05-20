/**
 * Builds the lightweight model used by the G-code preview modal.
 * Large jobs are sampled so the canvas never stores or redraws every emitted
 * move while still keeping full-duration and full-bounds estimates.
 */

export type GcodePreviewMoveType = 'rapid' | 'travel' | 'cut';

export interface GcodePreviewMove {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  type: GcodePreviewMoveType;
  time: number;
}

export interface GcodePreviewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GcodePreviewModel {
  moves: GcodePreviewMove[];
  bounds: GcodePreviewBounds;
  totalDuration: number;
  totalMoveCount: number;
  travelCount: number;
  cutCount: number;
  sourceLineCount: number;
  sampledLineStep: number;
  sampledMoveStep: number;
  isSampled: boolean;
}

export interface GcodePreviewModelOptions {
  maxSourceLines?: number;
  maxPreviewMoves?: number;
}

export const DEFAULT_MAX_SOURCE_LINES = 100_000;
export const DEFAULT_MAX_PREVIEW_MOVES = 20_000;

function countGcodeLines(gcode: string): number {
  if (!gcode) return 0;
  let count = 1;
  for (let i = 0; i < gcode.length; i++) {
    if (gcode.charCodeAt(i) === 10) count++;
  }
  return count;
}

function forEachGcodeLine(gcode: string, visit: (line: string) => void): void {
  let start = 0;
  for (;;) {
    const end = gcode.indexOf('\n', start);
    if (end === -1) {
      visit(gcode.slice(start));
      return;
    }
    visit(gcode.slice(start, end));
    start = end + 1;
  }
}

function stripGcodeComments(line: string): string {
  return line
    .replace(/\([^)]*\)/g, ' ')
    .replace(/;.*$/g, ' ');
}

function parseGcodeWords(line: string): Array<{ letter: string; value: number }> {
  const words: Array<{ letter: string; value: number }> = [];
  const wordPattern = /([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(line)) !== null) {
    const value = parseFloat(match[2]);
    if (Number.isFinite(value)) {
      words.push({ letter: match[1].toUpperCase(), value });
    }
  }
  return words;
}

function emptyModel(sourceLineCount: number): GcodePreviewModel {
  return {
    moves: [],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    totalDuration: 0,
    totalMoveCount: 0,
    travelCount: 0,
    cutCount: 0,
    sourceLineCount,
    sampledLineStep: 1,
    sampledMoveStep: 1,
    isSampled: false,
  };
}

export function buildGcodePreviewModel(
  gcode: string,
  options: GcodePreviewModelOptions = {},
): GcodePreviewModel {
  const sourceLineCount = countGcodeLines(gcode);
  if (!gcode || sourceLineCount === 0) {
    return emptyModel(sourceLineCount);
  }

  const maxSourceLines = Math.max(1, options.maxSourceLines ?? DEFAULT_MAX_SOURCE_LINES);
  const maxPreviewMoves = Math.max(1, options.maxPreviewMoves ?? DEFAULT_MAX_PREVIEW_MOVES);
  const sampledLineStep = Math.max(1, Math.ceil(sourceLineCount / maxSourceLines));
  const sampledMoveStep = Math.max(1, sampledLineStep, Math.ceil(sourceLineCount / maxPreviewMoves));

  const moves: GcodePreviewMove[] = [];
  let x = 0;
  let y = 0;
  let feedRate = 1000;
  let totalDuration = 0;
  let modalRapid = true;
  let totalMoveCount = 0;
  let travelCount = 0;
  let cutCount = 0;
  let laserModalOn = false;
  let distanceMode: 'absolute' | 'relative' = 'absolute';
  let spindlePower = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  forEachGcodeLine(gcode, (line) => {
    const trimmed = stripGcodeComments(line).trim();
    if (!trimmed || trimmed.startsWith(';')) return;

    const words = parseGcodeWords(trimmed);
    let xWord: number | null = null;
    let yWord: number | null = null;

    for (const word of words) {
      if (word.letter === 'G') {
        const gNum = Math.trunc(word.value);
        if (gNum === 0) modalRapid = true;
        else if (gNum === 1 || gNum === 2 || gNum === 3) modalRapid = false;
        else if (gNum === 90) distanceMode = 'absolute';
        else if (gNum === 91) distanceMode = 'relative';
      } else if (word.letter === 'M') {
        const mNum = Math.trunc(word.value);
        if (mNum === 3 || mNum === 4) laserModalOn = true;
        else if (mNum === 5) laserModalOn = false;
      } else if (word.letter === 'S') {
        spindlePower = word.value;
      } else if (word.letter === 'F') {
        feedRate = word.value;
      } else if (word.letter === 'X') {
        xWord = word.value;
      } else if (word.letter === 'Y') {
        yWord = word.value;
      }
    }

    if (xWord === null && yWord === null) return;

    const nx = xWord === null
      ? x
      : distanceMode === 'relative'
        ? x + xWord
        : xWord;
    const ny = yWord === null
      ? y
      : distanceMode === 'relative'
        ? y + yWord
        : yWord;
    const dist = Math.sqrt((nx - x) ** 2 + (ny - y) ** 2);
    const isRapid = modalRapid;
    const isCut = !isRapid && laserModalOn && spindlePower > 0;
    const speed = isRapid ? 5000 : (feedRate || 1000);
    const moveTime = dist > 0 ? (dist / speed) * 60 : 0;
    totalDuration += moveTime;
    totalMoveCount++;

    if (isCut) cutCount++;
    else travelCount++;

    minX = Math.min(minX, x, nx);
    minY = Math.min(minY, y, ny);
    maxX = Math.max(maxX, x, nx);
    maxY = Math.max(maxY, y, ny);

    const shouldKeep = ((totalMoveCount - 1) % sampledMoveStep) === 0;
    if (shouldKeep && moves.length < maxPreviewMoves) {
      moves.push({
        fromX: x,
        fromY: y,
        toX: nx,
        toY: ny,
        type: isRapid ? 'rapid' : (isCut ? 'cut' : 'travel'),
        time: totalDuration,
      });
    }

    x = nx;
    y = ny;
  });

  if (totalMoveCount === 0 || !Number.isFinite(minX)) {
    return emptyModel(sourceLineCount);
  }

  return {
    moves,
    bounds: { minX, minY, maxX, maxY },
    totalDuration,
    totalMoveCount,
    travelCount,
    cutCount,
    sourceLineCount,
    sampledLineStep,
    sampledMoveStep,
    isSampled: sampledLineStep > 1 || sampledMoveStep > 1 || moves.length < totalMoveCount,
  };
}
