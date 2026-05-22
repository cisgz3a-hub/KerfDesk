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
type MotionMode = 'G0' | 'G1' | 'G2' | 'G3';

interface ArcCenter {
  cx: number;
  cy: number;
}

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

function centerFromRMode(
  direction: 'G2' | 'G3',
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
): ArcCenter | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return null;

  const halfChord = chord / 2;
  const absR = Math.abs(r);
  if (absR < halfChord - 1e-6) return null;

  const midpointX = (x0 + x1) / 2;
  const midpointY = (y0 + y1) / 2;
  const offset = Math.sqrt(Math.max(0, absR * absR - halfChord * halfChord));
  const ux = dx / chord;
  const uy = dy / chord;
  const centerLeft = (r > 0) === (direction === 'G3');
  const px = centerLeft ? -uy : uy;
  const py = centerLeft ? ux : -ux;
  return { cx: midpointX + offset * px, cy: midpointY + offset * py };
}

function arcSweepRadians(direction: 'G2' | 'G3', startAngle: number, endAngle: number): number {
  let ccwSweep = endAngle - startAngle;
  while (ccwSweep < 0) ccwSweep += 2 * Math.PI;
  if (ccwSweep < 1e-9) ccwSweep = 2 * Math.PI;
  return direction === 'G3' ? ccwSweep : -(2 * Math.PI - ccwSweep);
}

function arcPreviewPoints(
  direction: 'G2' | 'G3',
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  center: ArcCenter,
): Array<{ x: number; y: number }> {
  const radius = Math.hypot(x0 - center.cx, y0 - center.cy);
  const endRadius = Math.hypot(x1 - center.cx, y1 - center.cy);
  if (radius < 1e-9 || Math.abs(radius - endRadius) > 1e-3) {
    return [{ x: x1, y: y1 }];
  }

  const startAngle = Math.atan2(y0 - center.cy, x0 - center.cx);
  const endAngle = Math.atan2(y1 - center.cy, x1 - center.cx);
  const sweep = arcSweepRadians(direction, startAngle, endAngle);
  const segments = Math.max(8, Math.min(96, Math.ceil(Math.abs(sweep) / (Math.PI / 18))));
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 1; i <= segments; i++) {
    const angle = startAngle + sweep * (i / segments);
    points.push({
      x: center.cx + Math.cos(angle) * radius,
      y: center.cy + Math.sin(angle) * radius,
    });
  }
  return points;
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
  let motionMode: MotionMode = 'G0';
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
    let iWord: number | null = null;
    let jWord: number | null = null;
    let rWord: number | null = null;

    for (const word of words) {
      if (word.letter === 'G') {
        const gNum = Math.trunc(word.value);
        if (gNum === 0) motionMode = 'G0';
        else if (gNum === 1) motionMode = 'G1';
        else if (gNum === 2) motionMode = 'G2';
        else if (gNum === 3) motionMode = 'G3';
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
      } else if (word.letter === 'I') {
        iWord = word.value;
      } else if (word.letter === 'J') {
        jWord = word.value;
      } else if (word.letter === 'R') {
        rWord = word.value;
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

    const moveType: GcodePreviewMoveType = motionMode === 'G0'
      ? 'rapid'
      : laserModalOn && spindlePower > 0
        ? 'cut'
        : 'travel';
    const addSegment = (fromX: number, fromY: number, toX: number, toY: number): void => {
      const dist = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
      const speed = moveType === 'rapid' ? 5000 : (feedRate || 1000);
      const moveTime = dist > 0 ? (dist / speed) * 60 : 0;
      totalDuration += moveTime;
      totalMoveCount++;

      if (moveType === 'cut') cutCount++;
      else travelCount++;

      minX = Math.min(minX, fromX, toX);
      minY = Math.min(minY, fromY, toY);
      maxX = Math.max(maxX, fromX, toX);
      maxY = Math.max(maxY, fromY, toY);

      const shouldKeep = ((totalMoveCount - 1) % sampledMoveStep) === 0;
      if (shouldKeep && moves.length < maxPreviewMoves) {
        moves.push({
          fromX,
          fromY,
          toX,
          toY,
          type: moveType,
          time: totalDuration,
        });
      }
    };

    if (motionMode === 'G2' || motionMode === 'G3') {
      const center = rWord !== null && iWord === null && jWord === null
        ? centerFromRMode(motionMode, x, y, nx, ny, rWord)
        : { cx: x + (iWord ?? 0), cy: y + (jWord ?? 0) };
      let fromX = x;
      let fromY = y;
      for (const point of center ? arcPreviewPoints(motionMode, x, y, nx, ny, center) : [{ x: nx, y: ny }]) {
        addSegment(fromX, fromY, point.x, point.y);
        fromX = point.x;
        fromY = point.y;
      }
    } else {
      addSegment(x, y, nx, ny);
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
