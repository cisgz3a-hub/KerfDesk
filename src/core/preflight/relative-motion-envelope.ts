// Relative-origin motion envelope — extracted from preflight.ts at the file
// size cap. For jobs placed relative to a user origin the absolute machine
// position is unknown, so bounds checking degrades to a SPAN check: the job's
// total X/Y motion extent must fit the bed even at the worst-case placement.
import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';
import { arcAabb } from '../invariants/arc-bounds';
import { asGcodeLines } from '../invariants/gcode-words';
import { isGcodeCommand, parseGcodeWord, stripGcodeComment } from '../invariants';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Point = { readonly x: number; readonly y: number };
type MotionEnvelope = { readonly next: Point; readonly arcBounds?: Bounds };

export function findRelativeMotionEnvelopeIssues(
  gcode: string | ReadonlyArray<string>,
  bed: { readonly width: number; readonly height: number },
): ReadonlyArray<string> {
  const bounds = collectRelativeMotionEnvelope(gcode);
  if (bounds === null) return [];
  const issues: string[] = [];
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width > bed.width) {
    issues.push(
      `Relative job motion spans ${width.toFixed(3)} mm in X, exceeding the ${bed.width} mm bed width. Scale the artwork down or reduce overscan.`,
    );
  }
  if (height > bed.height) {
    issues.push(
      `Relative job motion spans ${height.toFixed(3)} mm in Y, exceeding the ${bed.height} mm bed height. Scale the artwork down.`,
    );
  }
  return issues;
}

function collectRelativeMotionEnvelope(gcode: string | ReadonlyArray<string>): Bounds | null {
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let current: Point = { x: 0, y: 0 };
  let absolute = true;
  let modalMotion: GcodeMotionMode | null = 0;
  let any = false;
  for (const raw of asGcodeLines(gcode)) {
    const stripped = stripGcodeComment(raw);
    absolute = absoluteModeAfterLine(stripped, absolute);
    const scanned = scanModalMotionLine(stripped, modalMotion);
    modalMotion = scanned.motion;
    if (!scanned.isMotion || modalMotion === null) continue;
    const motion = motionEnvelopeForLine(stripped, current, absolute, modalMotion);
    if (motion === null) continue;
    mergePoint(bounds, current);
    mergePoint(bounds, motion.next);
    if (motion.arcBounds !== undefined) mergeBounds(bounds, motion.arcBounds);
    current = motion.next;
    any = true;
  }
  return any ? bounds : null;
}

function motionEnvelopeForLine(
  line: string,
  current: Point,
  absolute: boolean,
  motion: GcodeMotionMode,
): MotionEnvelope | null {
  const x = parseGcodeWord(line, 'X');
  const y = parseGcodeWord(line, 'Y');
  const next = motionEndPoint(current, x, y, absolute);
  const arcBounds = arcBoundsForLine(line, current, next, motion);
  if (x === null && y === null && arcBounds === undefined) return null;
  return {
    next,
    ...(arcBounds === undefined ? {} : { arcBounds }),
  };
}

function motionEndPoint(
  current: Point,
  x: number | null,
  y: number | null,
  absolute: boolean,
): Point {
  return absolute
    ? { x: x ?? current.x, y: y ?? current.y }
    : { x: current.x + (x ?? 0), y: current.y + (y ?? 0) };
}

function arcBoundsForLine(
  line: string,
  current: Point,
  next: Point,
  motion: GcodeMotionMode,
): Bounds | undefined {
  if (motion !== 2 && motion !== 3) return undefined;
  const i = parseGcodeWord(line, 'I');
  const j = parseGcodeWord(line, 'J');
  return i === null || j === null ? undefined : arcAabb(current, next, i, j, motion === 2);
}

function absoluteModeAfterLine(line: string, current: boolean): boolean {
  if (isGcodeCommand(line, 'G90')) return true;
  if (isGcodeCommand(line, 'G91')) return false;
  return current;
}

function mergePoint(bounds: Bounds, point: Point): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

function mergeBounds(bounds: Bounds, candidate: Bounds): void {
  bounds.minX = Math.min(bounds.minX, candidate.minX);
  bounds.maxX = Math.max(bounds.maxX, candidate.maxX);
  bounds.minY = Math.min(bounds.minY, candidate.minY);
  bounds.maxY = Math.max(bounds.maxY, candidate.maxY);
}
