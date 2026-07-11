// Invariant predicates over emitted G-code strings.
//
// These back the property tests in Phase A acceptance (PROJECT.md "Vertical
// slice — Phase A acceptance"). They walk the G-code line-by-line and return
// `Issue`s rather than throwing — the caller decides whether a non-empty list
// is a test failure, a preflight modal, or both.
//
// Predicates accept any G-code string and are deliberately liberal about
// formatting: comments stripped, blank lines skipped, trailing-whitespace
// tolerated. This means they can validate G-code from external tools too, not
// just GrblStrategy's output.
import {
  isArcMotion,
  isClockwiseArc,
  isGcodeCommand,
  isGcodeMotionCommand,
  parseGcodeWord,
  stripGcodeComment,
} from './gcode-words';
import { arcAabb } from './arc-bounds';

export type Issue = {
  readonly lineNumber: number;
  readonly line: string;
  readonly reason: string;
};

export type MotionBoundsOffset = {
  readonly x: number;
  readonly y: number;
};

export type OutOfBoundsCoordOptions = {
  readonly motionOffset?: MotionBoundsOffset | undefined;
};

type BoundsRect = {
  readonly minX?: number;
  readonly minY?: number;
  readonly maxX?: number;
  readonly maxY?: number;
  readonly width: number;
  readonly height: number;
};

// PROJECT.md non-negotiable #3 — Laser-off on travel.
// A `G0` is safe if any of:
//   (a) `S0` is on the same line,
//   (b) the most recent non-comment line was `M5` or `M107` (fan-laser off,
//       Marlin fan-mode dialect — ADR-095),
//   (c) the most recent S value seen is 0 (sticky firmware state; `M107`
//       counts as S0 because it zeroes the fan-laser PWM).
export function findLaserOnTravelIssues(gcode: string): readonly Issue[] {
  const lines = gcode.split('\n');
  const issues: Issue[] = [];
  let lastEffective = '';
  let stickyS: number | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const stripped = stripGcodeComment(raw);
    if (stripped === '') continue;
    const sVal = parseGcodeWord(stripped, 'S');
    if (sVal !== null) stickyS = sVal;
    if (isGcodeCommand(stripped, 'M107')) stickyS = 0;
    if (isGcodeCommand(stripped, 'G0')) {
      const okInline = sVal === 0;
      const okPriorOff =
        isGcodeCommand(lastEffective, 'M5') || isGcodeCommand(lastEffective, 'M107');
      const okSticky = stickyS === 0;
      if (!okInline && !okPriorOff && !okSticky) {
        issues.push({
          lineNumber: i + 1,
          line: raw,
          reason: 'G0 without S0 and no preceding M5/M107 / sticky S0',
        });
      }
    }
    lastEffective = stripped;
  }
  return issues;
}

// PROJECT.md non-negotiable #1 — Bounds check.
// Every X / Y emitted by a motion command (G0/G1/G2/G3) must fall inside the
// rectangle [0, width] × [0, height], in machine coordinates.
export function findOutOfBoundsCoords(
  gcode: string,
  bed: BoundsRect,
  options: OutOfBoundsCoordOptions = {},
): readonly Issue[] {
  const lines = gcode.split('\n');
  const issues: Issue[] = [];
  const offset = options.motionOffset ?? { x: 0, y: 0 };
  const limits = {
    minX: bed.minX ?? 0,
    minY: bed.minY ?? 0,
    maxX: bed.maxX ?? bed.width,
    maxY: bed.maxY ?? bed.height,
  };
  // Modal position, so a G2/G3 arc knows its start point (the previous
  // endpoint). GRBL programs start at the current machine position; for the
  // emitted-text scan we track from 0,0 like the rest of the bounds contract.
  let pos = { x: 0, y: 0 };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const stripped = stripGcodeComment(raw);
    if (!isGcodeMotionCommand(stripped)) continue;
    pos = scanMotionLineBounds(issues, stripped, pos, offset, limits, i + 1, raw);
  }
  return issues;
}

// Check one motion line's endpoint (and, for a G2/G3 arc, its bulge) against
// the bed, and return the updated modal position.
function scanMotionLineBounds(
  issues: Issue[],
  stripped: string,
  pos: { x: number; y: number },
  offset: { x: number; y: number },
  limits: { minX: number; minY: number; maxX: number; maxY: number },
  lineNumber: number,
  line: string,
): { x: number; y: number } {
  const x = parseGcodeWord(stripped, 'X');
  const y = parseGcodeWord(stripped, 'Y');
  appendAxisBoundsIssue(issues, 'X', x, offset.x, limits.minX, limits.maxX, lineNumber, line);
  appendAxisBoundsIssue(issues, 'Y', y, offset.y, limits.minY, limits.maxY, lineNumber, line);
  if (isArcMotion(stripped)) {
    appendArcBoundsIssue(issues, stripped, pos, x, y, offset, limits, lineNumber, line);
  }
  return { x: x ?? pos.x, y: y ?? pos.y };
}

// A G2/G3 arc can bow outside the bed while both endpoints sit inside it, so
// the endpoint-word check above is blind to it. Compute the arc's true extent
// from its centre offset (I/J) and direction, and flag any side that clears the
// bed. Only reachable for CNC output (the laser strategy emits no arcs).
function appendArcBoundsIssue(
  issues: Issue[],
  stripped: string,
  start: { x: number; y: number },
  endX: number | null,
  endY: number | null,
  offset: { x: number; y: number },
  limits: { minX: number; minY: number; maxX: number; maxY: number },
  lineNumber: number,
  line: string,
): void {
  const iWord = parseGcodeWord(stripped, 'I');
  const jWord = parseGcodeWord(stripped, 'J');
  if (iWord === null || jWord === null) return;
  const end = { x: endX ?? start.x, y: endY ?? start.y };
  const box = arcAabb(start, end, iWord, jWord, isClockwiseArc(stripped));
  const parts: string[] = [];
  if (box.minX + offset.x < limits.minX) parts.push(`X ${box.minX + offset.x}`);
  else if (box.maxX + offset.x > limits.maxX) parts.push(`X ${box.maxX + offset.x}`);
  if (box.minY + offset.y < limits.minY) parts.push(`Y ${box.minY + offset.y}`);
  else if (box.maxY + offset.y > limits.maxY) parts.push(`Y ${box.maxY + offset.y}`);
  if (parts.length > 0) {
    issues.push({ lineNumber, line, reason: `Arc bulges out of bed: ${parts.join(', ')}` });
  }
}

function appendAxisBoundsIssue(
  issues: Issue[],
  axis: 'X' | 'Y',
  value: number | null,
  offset: number,
  min: number,
  max: number,
  lineNumber: number,
  line: string,
): void {
  if (value === null) return;
  const physical = value + offset;
  if (physical < min || physical > max) {
    issues.push({ lineNumber, line, reason: `${axis} out of bed: ${physical}` });
  }
}

// PROJECT.md non-negotiable #7 — Power scale honest.
// The expected S value for a given power percentage and the device's
// $30 max power scale, rounded to the nearest integer.
export function expectedS(powerPercent: number, maxPowerS: number): number {
  return Math.round((powerPercent / 100) * maxPowerS);
}

function collectG1WordValues(gcode: string, word: 'S' | 'F'): readonly number[] {
  const lines = gcode.split('\n');
  const out: number[] = [];
  for (const raw of lines) {
    const stripped = stripGcodeComment(raw);
    if (!isGcodeCommand(stripped, 'G1')) continue;
    const value = parseGcodeWord(stripped, word);
    if (value !== null) out.push(value);
  }
  return out;
}

// Collect every S value that appears on a G1 motion line.
export function collectG1SValues(gcode: string): readonly number[] {
  return collectG1WordValues(gcode, 'S');
}

// Collect every F value that appears on a G1 motion line. Backs the per-layer
// speed-correctness assertions: inside one layer's section every G1 F must be
// that layer's feed.
export function collectG1FValues(gcode: string): readonly number[] {
  return collectG1WordValues(gcode, 'F');
}
