// buildGcodeRenderModel (ADR-255 stage 2) — one modal pass over a program
// producing the typed-array render model: segments with source-line mapping
// and modal F/S, program events, and the total-line-accountability array.
// Composes the shared engine (core/gcode); forgiving by design — bad arcs and
// unknown words become findings, never failures (ADR-255 §5).

import {
  ARC_EPSILON,
  arcSweepAngle,
  ijArcCenter,
  rArcGeometry,
  scanGcodeWords,
  stripInlineComments,
} from '../gcode';
import { sampleArcPoints } from '../geometry';
import { expandCannedCycle } from './canned-cycle';
import { applyLineWords, type RenderModal } from './render-model-words';
import { computeProgramStats } from './program-stats';
import { createSegmentBuilder, type SegmentBuilder } from './segment-builder';
import {
  LINE_CATEGORY,
  SEG_KIND,
  SEG_MOTION,
  type BuildRenderModelOptions,
  type BuildRenderModelResult,
  type ProgramEvent,
  type SkippedMotion,
  type UnsupportedWordCount,
} from './render-model-types';

const DEFAULT_MAX_LINES = 500_000;
const AXIS_EPSILON = 1e-9;
// GRBL validates R-form/IJ arcs to ~0.005 in (mirrors the F-CNC10 parser).
const ARC_RADIUS_TOLERANCE_MM = 0.127;
const XY_PLANE = 17;

type BuildContext = {
  readonly modal: RenderModal;
  readonly segments: SegmentBuilder;
  readonly events: ProgramEvent[];
  readonly skipped: SkippedMotion[];
  readonly unsupported: Map<string, { count: number; firstLine: number }>;
  recognizedWords: number;
};

export function buildGcodeRenderModel(
  text: string,
  options: BuildRenderModelOptions = {},
): BuildRenderModelResult {
  const lines = text.split(/\r\n|\n|\r/);
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  if (lines.length > maxLines) {
    return { kind: 'error', reason: `Program exceeds ${maxLines} lines.` };
  }
  const context: BuildContext = {
    modal: freshModal(),
    segments: createSegmentBuilder(),
    events: [],
    skipped: [],
    unsupported: new Map(),
    recognizedWords: 0,
  };
  const categories = new Uint8Array(lines.length);
  for (const [index, raw] of lines.entries()) {
    categories[index] = processLine(context, raw, index);
  }
  if (context.recognizedWords === 0) {
    return { kind: 'error', reason: 'This does not look like G-code.' };
  }
  const finished = context.segments.finish();
  return {
    kind: 'ok',
    model: {
      ...finished,
      lineCount: lines.length,
      lineCategories: categories,
      events: context.events,
      unsupportedWords: unsupportedList(context.unsupported),
      skippedMotions: context.skipped,
      stats: computeProgramStats(finished),
    },
  };
}

function freshModal(): RenderModal {
  return {
    motion: 0,
    unitScale: 1,
    absolute: true,
    x: 0,
    y: 0,
    z: 0,
    feed: 0,
    power: 0,
    plane: XY_PLANE,
    ended: false,
    cycle: null,
    // LinuxCNC's default retract mode is G98 (back to the initial Z).
    retractMode: 98,
    cycleR: null,
    cycleZ: null,
    cycleQ: null,
    cycleInitialZ: 0,
  };
}

function processLine(context: BuildContext, raw: string, line: number): number {
  if (raw.trim() === '') return LINE_CATEGORY.blank;
  const stripped = stripInlineComments(raw);
  if (stripped === '') return LINE_CATEGORY.comment;
  if (stripped === '%') return LINE_CATEGORY.marker;
  if (context.modal.ended) return LINE_CATEGORY.afterEnd;
  const words = scanGcodeWords(stripped);
  const consumed = words.reduce((sum, word) => sum + word.matchedLength, 0);
  const nonSpace = stripped.replace(/\s+/g, '').length;
  if (words.length === 0 || consumed < nonSpace * 0.5) return LINE_CATEGORY.junk;
  context.recognizedWords += words.length;
  const outcome = applyLineWords(context.modal, words, line, {
    countUnsupported: (word, atLine) => countUnsupported(context.unsupported, word, atLine),
    pushEvent: (event) => context.events.push(event),
  });
  if (emitLineMotion(context, outcome, line)) return LINE_CATEGORY.motion;
  if (outcome.sawEvent) return LINE_CATEGORY.event;
  if (outcome.sawModal) return LINE_CATEGORY.modalOnly;
  if (outcome.sawUnsupported) return LINE_CATEGORY.unsupported;
  return LINE_CATEGORY.modalOnly;
}

// Routes a line to the right emitter. Returns whether it produced motion.
function emitLineMotion(
  context: BuildContext,
  outcome: ReturnType<typeof applyLineWords>,
  line: number,
): boolean {
  if (outcome.homeAxes !== null) {
    emitHome(context, outcome.homeAxes, line);
    return true;
  }
  if (outcome.axisWords.size === 0) return false;
  if (context.modal.cycle !== null) {
    emitCannedCycle(context, outcome.axisWords, outcome.peckDepth, line);
    return true;
  }
  emitMotion(context, outcome.axisWords, line);
  return true;
}

// G28 homes the named axes (all when none named) to work zero — rendered as
// a rapid so homing motion is visible rather than teleported.
function emitHome(context: BuildContext, axes: ReadonlyArray<'X' | 'Y' | 'Z'>, line: number): void {
  const { modal } = context;
  const all = axes.length === 0;
  const target = {
    x: all || axes.includes('X') ? 0 : modal.x,
    y: all || axes.includes('Y') ? 0 : modal.y,
    z: all || axes.includes('Z') ? 0 : modal.z,
  };
  const savedMotion = modal.motion;
  modal.motion = 0;
  emitLinear(context, target, line);
  modal.motion = savedMotion;
  modal.x = target.x;
  modal.y = target.y;
  modal.z = target.z;
}

function emitMotion(
  context: BuildContext,
  axisWords: ReadonlyMap<string, number>,
  line: number,
): void {
  const { modal } = context;
  const target = resolveTarget(modal, axisWords);
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
    context.skipped.push({ line, reason: 'non-finite target coordinate' });
    return;
  }
  if (modal.motion === 2 || modal.motion === 3) {
    // A skipped (invalid) arc moves nothing — the controller would have
    // rejected the line, so the modal position must not advance either.
    if (!emitArc(context, axisWords, target, line)) return;
  } else {
    emitLinear(context, target, line);
  }
  modal.x = target.x;
  modal.y = target.y;
  modal.z = target.z;
}

// One canned-cycle hole. R/Z/Q are sticky, so a bare X/Y line after the
// cycle word drills another hole with the same depth and clearance.
function emitCannedCycle(
  context: BuildContext,
  axisWords: ReadonlyMap<string, number>,
  peckDepth: number | null,
  line: number,
): void {
  const { modal } = context;
  const cycle = modal.cycle;
  if (cycle === null) return;
  const scaled = (letter: string): number | null => {
    const raw = axisWords.get(letter);
    return raw === undefined ? null : raw * modal.unitScale;
  };
  modal.cycleR = scaled('R') ?? modal.cycleR;
  modal.cycleZ = scaled('Z') ?? modal.cycleZ;
  modal.cycleQ = peckDepth === null ? modal.cycleQ : peckDepth * modal.unitScale;
  const target = resolveTarget(modal, axisWords);
  if (modal.cycleR === null || modal.cycleZ === null) {
    context.skipped.push({ line, reason: 'canned cycle needs both R and Z' });
    return;
  }
  const from = { x: modal.x, y: modal.y, z: modal.z };
  const moves = expandCannedCycle({
    cycle,
    retract: modal.retractMode,
    target: { x: target.x, y: target.y, z: modal.cycleZ },
    rPlane: modal.cycleR,
    peck: modal.cycleQ,
    from,
    initialZ: modal.cycleInitialZ,
  });
  for (const move of moves) {
    const savedMotion = modal.motion;
    modal.motion = move.rapid ? 0 : 1;
    emitLinear(context, move.to, line);
    modal.motion = savedMotion;
    modal.x = move.to.x;
    modal.y = move.to.y;
    modal.z = move.to.z;
  }
}

function resolveTarget(
  modal: RenderModal,
  words: ReadonlyMap<string, number>,
): { x: number; y: number; z: number } {
  const axis = (name: string, current: number): number => {
    const raw = words.get(name);
    if (raw === undefined) return current;
    const scaled = raw * modal.unitScale;
    return modal.absolute ? scaled : current + scaled;
  };
  return { x: axis('X', modal.x), y: axis('Y', modal.y), z: axis('Z', modal.z) };
}

function emitLinear(
  context: BuildContext,
  target: { x: number; y: number; z: number },
  line: number,
): void {
  const { modal } = context;
  const xyLength = Math.hypot(target.x - modal.x, target.y - modal.y);
  const dz = target.z - modal.z;
  const length = Math.hypot(xyLength, dz);
  if (length <= AXIS_EPSILON) return;
  const motion = modal.motion === 0 ? SEG_MOTION.rapid : SEG_MOTION.linear;
  const zOnly = xyLength <= AXIS_EPSILON;
  const zKind = dz < 0 ? SEG_KIND.plunge : SEG_KIND.retract;
  const xyKind = modal.motion === 0 ? SEG_KIND.travel : SEG_KIND.cut;
  context.segments.push({
    x0: modal.x,
    y0: modal.y,
    z0: modal.z,
    x1: target.x,
    y1: target.y,
    z1: target.z,
    kind: zOnly ? zKind : xyKind,
    motion,
    line,
    feed: modal.feed,
    power: modal.power,
    lengthMm: length,
  });
}

function emitArc(
  context: BuildContext,
  axisWords: ReadonlyMap<string, number>,
  target: { x: number; y: number; z: number },
  line: number,
): boolean {
  const { modal } = context;
  if (modal.plane !== XY_PLANE) {
    context.skipped.push({ line, reason: 'G18/G19 plane arcs are not renderable (XY only)' });
    return false;
  }
  const clockwise = modal.motion === 2;
  const from = { x: modal.x, y: modal.y };
  const center = solveArcCenter(context, axisWords, from, target, clockwise, line);
  if (center === null) return false;
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  const endRadius = Math.hypot(target.x - center.x, target.y - center.y);
  if (Math.abs(radius - endRadius) > ARC_RADIUS_TOLERANCE_MM) {
    context.skipped.push({ line, reason: 'arc radius mismatch between start and end points' });
    return false;
  }
  if (radius <= ARC_EPSILON) {
    context.skipped.push({ line, reason: 'arc radius is zero' });
    return false;
  }
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const endAngle = Math.atan2(target.y - center.y, target.x - center.x);
  const samePoint =
    Math.abs(from.x - target.x) <= AXIS_EPSILON && Math.abs(from.y - target.y) <= AXIS_EPSILON;
  const sweep = arcSweepAngle(startAngle, endAngle, clockwise, samePoint);
  const points = sampleArcPoints(center, radius, startAngle, sweep);
  points[points.length - 1] = { x: target.x, y: target.y };
  pushArcPairs(context, points, target, sweep * radius, line, clockwise);
  return true;
}

function solveArcCenter(
  context: BuildContext,
  axisWords: ReadonlyMap<string, number>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  clockwise: boolean,
  line: number,
): { x: number; y: number } | null {
  const i = axisWords.get('I');
  const j = axisWords.get('J');
  if (i !== undefined || j !== undefined) {
    return ijArcCenter(from, i, j, context.modal.unitScale);
  }
  const r = axisWords.get('R');
  if (r === undefined) {
    context.skipped.push({ line, reason: 'arc needs I/J or R' });
    return null;
  }
  const solved = rArcGeometry(from, to, r, clockwise, context.modal.unitScale);
  if (solved === null) {
    context.skipped.push({ line, reason: 'R-form arc cannot start and end at the same point' });
    return null;
  }
  if (solved.halfChordGapSq < -ARC_RADIUS_TOLERANCE_MM * solved.chordMm) {
    context.skipped.push({ line, reason: 'arc radius too small for its chord' });
    return null;
  }
  return solved.center;
}

// Distributes the arc-true length (3D-helix-true when Z moves) across the
// sampled pairs by chord proportion so the cumulative route stays exact.
function pushArcPairs(
  context: BuildContext,
  points: ReadonlyArray<{ x: number; y: number }>,
  target: { x: number; y: number; z: number },
  signedArcLength: number,
  line: number,
  clockwise: boolean,
): void {
  const { modal } = context;
  const dz = target.z - modal.z;
  const planarLength = Math.abs(signedArcLength);
  const trueLength = Math.hypot(planarLength, dz);
  let chordTotal = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) chordTotal += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const denominator = Math.max(1, points.length - 1);
  let previous = { x: modal.x, y: modal.y, z: modal.z };
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const before = points[index - 1];
    if (point === undefined || before === undefined) continue;
    const z = modal.z + (dz * index) / denominator;
    const chord = Math.hypot(point.x - before.x, point.y - before.y);
    const share = chordTotal > 0 ? chord / chordTotal : 1 / denominator;
    context.segments.push({
      x0: previous.x,
      y0: previous.y,
      z0: previous.z,
      x1: point.x,
      y1: point.y,
      z1: z,
      kind: SEG_KIND.cut,
      motion: clockwise ? SEG_MOTION.cw : SEG_MOTION.ccw,
      line,
      feed: modal.feed,
      power: modal.power,
      lengthMm: trueLength * share,
    });
    previous = { x: point.x, y: point.y, z };
  }
}

function countUnsupported(
  map: Map<string, { count: number; firstLine: number }>,
  word: string,
  line: number,
): void {
  const existing = map.get(word);
  if (existing === undefined) map.set(word, { count: 1, firstLine: line });
  else existing.count += 1;
}

function unsupportedList(
  map: ReadonlyMap<string, { count: number; firstLine: number }>,
): ReadonlyArray<UnsupportedWordCount> {
  return [...map.entries()].map(([word, entry]) => ({
    word,
    count: entry.count,
    firstLine: entry.firstLine,
  }));
}
