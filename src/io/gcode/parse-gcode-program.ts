// parseGcodeProgram — clean-room modal G-code (.nc) parser feeding the CNC
// simulator (Phase H.6b, ADR-098 §2, WORKFLOW.md F-CNC10). The program is
// converted straight into the preview's Toolpath model (travel / cut /
// plunge steps with Z spans), so the removal grid, scrubber, and distance
// stats work on external programs exactly as on native compiles.
//
// Dialect: GRBL-flavor. G0/G1 (ramped XY+Z and pure-Z), G2/G3 arcs (I/J
// incremental center or R form, helical Z), G90/G91, G20/G21, G17, F/S/N
// words, `(...)` and `;` comments, `%` markers, M2/M30 program end.
// Unsupported words are counted in notes, never fatal.

import {
  applySharedGCode,
  arcSweepAngle,
  ijArcCenter,
  rArcGeometry,
  resolveAxisTarget,
  scanGcodeWords,
  stripInlineComments,
} from '../../core/gcode';
import { sampleArcPoints } from '../../core/geometry';
import type { Toolpath, ToolpathStep } from '../../core/job';
import type { Vec2 } from '../../core/scene';

// Display color for external-program cut steps (no scene layers to key on).
export const GCODE_PREVIEW_CUT_COLOR = '#7c3aed';

const MAX_PROGRAM_LINES = 500_000;
const AXIS_EPSILON = 1e-9;
// GRBL validates R-form/IJ arcs to ~0.005 in; allow the same order. Mirrors
// CIRCULAR_ARC_RADIUS_TOLERANCE_MM in core/geometry/circular-arc.ts.
const ARC_RADIUS_TOLERANCE_MM = 0.127;

export type GcodeProgramSummary = {
  readonly lineCount: number;
  readonly cutMm: number;
  readonly travelMm: number;
  readonly plungeMm: number;
};

export type ParseGcodeProgramResult =
  | {
      readonly kind: 'ok';
      readonly toolpath: Toolpath;
      readonly summary: GcodeProgramSummary;
      readonly notes: ReadonlyArray<string>;
    }
  | { readonly kind: 'error'; readonly reason: string };

type ModalState = {
  motion: 0 | 1 | 2 | 3;
  unitScale: number;
  absolute: boolean;
  x: number;
  y: number;
  z: number;
  ended: boolean;
};

type LineWords = ReadonlyMap<string, number>;

export function parseGcodeProgram(text: string): ParseGcodeProgramResult {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > MAX_PROGRAM_LINES) {
    return { kind: 'error', reason: `Program exceeds ${MAX_PROGRAM_LINES} lines.` };
  }
  const state: ModalState = {
    motion: 0,
    unitScale: 1,
    absolute: true,
    x: 0,
    y: 0,
    z: 0,
    ended: false,
  };
  const steps: ToolpathStep[] = [];
  const unsupported = new Map<string, number>();
  let recognizedWords = 0;
  let firstJunkLine: { line: number; text: string } | null = null;

  for (let i = 0; i < lines.length && !state.ended; i += 1) {
    const stripped = stripInlineComments(lines[i] ?? '');
    if (stripped === '' || stripped === '%') continue;
    const words = readWords(stripped);
    if (words === null) {
      if (firstJunkLine === null) firstJunkLine = { line: i + 1, text: stripped };
      continue;
    }
    recognizedWords += words.size;
    const issue = executeLine(state, words, steps, unsupported, i + 1);
    if (issue !== null) return { kind: 'error', reason: issue };
  }
  if (recognizedWords === 0) {
    const at =
      firstJunkLine === null
        ? ''
        : ` (first line ${firstJunkLine.line}: "${firstJunkLine.text.slice(0, 32)}")`;
    return { kind: 'error', reason: `This does not look like G-code${at}.` };
  }
  return {
    kind: 'ok',
    toolpath: { steps, totalLength: steps.reduce((sum, step) => sum + step.length, 0) },
    summary: summarize(lines.length, steps),
    notes: [...unsupported.entries()].map(([word, count]) => `${count}× unsupported ${word}`),
  };
}

// null = the line contains non-word garbage (not even one letter+number).
function readWords(line: string): LineWords | null {
  const words = new Map<string, number>();
  const matches = scanGcodeWords(line);
  let consumed = 0;
  for (const match of matches) {
    consumed += match.matchedLength;
    // Multiple G words per line are modal-legal; suffix them for uniqueness.
    if (match.letter === 'G' || match.letter === 'M') {
      words.set(`${match.letter}${match.value}`, match.value);
    } else {
      words.set(match.letter, match.value);
    }
  }
  // Whitespace apart, everything on the line should be words.
  const nonSpace = line.replace(/\s+/g, '').length;
  if (matches.length === 0 || consumed < nonSpace * 0.5) return null;
  return words;
}

function executeLine(
  state: ModalState,
  words: LineWords,
  steps: ToolpathStep[],
  unsupported: Map<string, number>,
  lineNumber: number,
): string | null {
  for (const [key, value] of words) {
    const issue = applyModalWord(state, key, value, unsupported, lineNumber);
    if (issue !== null) return issue;
  }
  if (state.ended) return null;
  const hasTarget = ['X', 'Y', 'Z', 'I', 'J', 'R'].some((axis) => words.has(axis));
  if (!hasTarget) return null;
  const target = resolveTarget(state, words);
  if (state.motion === 2 || state.motion === 3) {
    return emitArc(state, words, target, steps, lineNumber);
  }
  emitLinear(state, target, steps);
  return null;
}

// Parser-specific modal effects: program end plus recognized no-ops (G17 and
// the spindle/coolant M words — no geometric effect). The shared motion /
// units / distance words route through applySharedGCode first.
const MODAL_EFFECTS: Readonly<Record<string, (state: ModalState) => void>> = {
  G17: () => undefined,
  M2: (s) => {
    s.ended = true;
  },
  M30: (s) => {
    s.ended = true;
  },
  M3: () => undefined,
  M4: () => undefined,
  M5: () => undefined,
  M7: () => undefined,
  M8: () => undefined,
  M9: () => undefined,
};

function applyModalWord(
  state: ModalState,
  key: string,
  value: number,
  unsupported: Map<string, number>,
  lineNumber: number,
): string | null {
  if (!key.startsWith('G') && !key.startsWith('M')) return null;
  if (key === 'G18' || key === 'G19') {
    return `Line ${lineNumber}: ${key} plane arcs are not supported (XY/G17 only).`;
  }
  if (key.startsWith('G') && applySharedGCode(state, value)) return null;
  const effect = MODAL_EFFECTS[key];
  if (effect === undefined) {
    unsupported.set(key, (unsupported.get(key) ?? 0) + 1);
    return null;
  }
  effect(state);
  return null;
}

function resolveTarget(state: ModalState, words: LineWords): { x: number; y: number; z: number } {
  return resolveAxisTarget({ x: state.x, y: state.y, z: state.z }, words, state);
}

function emitLinear(
  state: ModalState,
  target: { x: number; y: number; z: number },
  steps: ToolpathStep[],
): void {
  const from: Vec2 = { x: state.x, y: state.y };
  const to: Vec2 = { x: target.x, y: target.y };
  const xyLength = Math.hypot(to.x - from.x, to.y - from.y);
  const zChanged = Math.abs(target.z - state.z) > AXIS_EPSILON;
  if (xyLength <= AXIS_EPSILON && zChanged) {
    steps.push({
      kind: 'plunge',
      at: from,
      fromZ: state.z,
      toZ: target.z,
      length: Math.abs(target.z - state.z),
    });
  } else if (xyLength > AXIS_EPSILON && state.motion === 0) {
    steps.push({
      kind: 'travel',
      from,
      to,
      length: xyLength,
      ...(zChanged ? { z: { from: state.z, to: target.z } } : {}),
    });
  } else if (xyLength > AXIS_EPSILON) {
    steps.push({
      kind: 'cut',
      color: GCODE_PREVIEW_CUT_COLOR,
      polyline: [from, to],
      length: xyLength,
      z: { from: state.z, to: target.z },
    });
  }
  state.x = target.x;
  state.y = target.y;
  state.z = target.z;
}

function emitArc(
  state: ModalState,
  words: LineWords,
  target: { x: number; y: number; z: number },
  steps: ToolpathStep[],
  lineNumber: number,
): string | null {
  const clockwise = state.motion === 2;
  const from: Vec2 = { x: state.x, y: state.y };
  const to: Vec2 = { x: target.x, y: target.y };
  const center = arcCenter(state, words, from, to, clockwise, lineNumber);
  if (typeof center === 'string') return center;
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  const endRadius = Math.hypot(to.x - center.x, to.y - center.y);
  if (Math.abs(radius - endRadius) > ARC_RADIUS_TOLERANCE_MM) {
    return `Line ${lineNumber}: arc radius mismatch (${radius.toFixed(3)} vs ${endRadius.toFixed(3)} mm).`;
  }
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
  const sweep = arcSweep(startAngle, endAngle, clockwise, from, to);
  const points = sampleArcPoints(center, radius, startAngle, sweep);
  // Snap the sampled endpoint onto the commanded target exactly.
  points[points.length - 1] = to;
  steps.push({
    kind: 'cut',
    color: GCODE_PREVIEW_CUT_COLOR,
    polyline: points,
    length: Math.abs(sweep) * radius,
    z: { from: state.z, to: target.z },
  });
  state.x = target.x;
  state.y = target.y;
  state.z = target.z;
  return null;
}

// I/J are ALWAYS incremental offsets from the current point in GRBL; the
// R form solves the center on the correct side for the ≤180° arc (negative
// R asks for the >180° arc, per the G-code spec). Geometry is shared with
// the motion manifest (core/gcode); the error POLICY here is this parser's.
function arcCenter(
  state: ModalState,
  words: LineWords,
  from: Vec2,
  to: Vec2,
  clockwise: boolean,
  lineNumber: number,
): Vec2 | string {
  const i = words.get('I');
  const j = words.get('J');
  if (i !== undefined || j !== undefined) {
    return ijArcCenter(from, i, j, state.unitScale);
  }
  const r = words.get('R');
  if (r === undefined) {
    return `Line ${lineNumber}: G${state.motion} arc needs I/J or R.`;
  }
  const solved = rArcGeometry(from, to, r, clockwise, state.unitScale);
  if (solved === null) {
    return `Line ${lineNumber}: R-form arc cannot start and end at the same point.`;
  }
  if (solved.halfChordGapSq < -ARC_RADIUS_TOLERANCE_MM * solved.chordMm) {
    return `Line ${lineNumber}: arc radius ${solved.radiusMm.toFixed(3)} mm is too small for its chord.`;
  }
  return solved.center;
}

function arcSweep(
  startAngle: number,
  endAngle: number,
  clockwise: boolean,
  from: Vec2,
  to: Vec2,
): number {
  const samePoint =
    Math.abs(from.x - to.x) <= AXIS_EPSILON && Math.abs(from.y - to.y) <= AXIS_EPSILON;
  return arcSweepAngle(startAngle, endAngle, clockwise, samePoint);
}

function summarize(lineCount: number, steps: ReadonlyArray<ToolpathStep>): GcodeProgramSummary {
  let cutMm = 0;
  let travelMm = 0;
  let plungeMm = 0;
  for (const step of steps) {
    if (step.kind === 'cut') cutMm += step.length;
    else if (step.kind === 'travel') travelMm += step.length;
    else plungeMm += step.length;
  }
  return { lineCount, cutMm, travelMm, plungeMm };
}
