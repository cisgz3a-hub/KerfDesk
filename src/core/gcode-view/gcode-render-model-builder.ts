// buildGcodeRenderModel (ADR-255 stage 2) — one modal pass over a program
// producing the typed-array render model: segments with source-line mapping
// and modal F/S, program events, and the total-line-accountability array.
// Composes the shared engine (core/gcode); forgiving by design — bad arcs and
// unknown words become findings, never failures (ADR-255 §5).

import { PROGRAM_PARSE_REASON, type GcodeWordMatch } from '../gcode';
// Deep import: the core/gcode barrel is at its public-export cap (ADR-015).
import { stripControllerComments } from '../gcode/word-scan';
import {
  createLaserRenderState,
  isLaserOffFeed,
  renderedPower,
  updateLaserRenderState,
  type LaserRenderState,
} from './laser-render-state';
import { expandCannedCycle } from './canned-cycle';
import { resolveCycleParameters } from './cycle-parameters';
import { createLineCategoryBuilder } from './line-category-builder';
import { applyLineWords, freshRenderModal, type RenderModal } from './render-model-words';
import { grblCoordinateWord, resolveTarget } from './render-model-coordinates';
import {
  isNativeLaserConsoleLine,
  nativeLaserMotionWords,
  scanControllerRenderWords,
} from './native-laser-render-words';
import { computeProgramStats } from './program-stats';
import { createProgramBoundsTracker, type ProgramBoundsTracker } from './program-bounds';
import { createPlacementReader, placeBeforeMotion } from './render-model-placement';
import { nonMotionCategory, recordUnplacedLine } from './render-model-line-accounting';
import { emitArc, grblArcBlockRejection } from './render-model-arc';
import {
  grblBlockRejection,
  grblBlockUncertainty,
  grblRejectedBlockWarning,
} from './grbl-block-rejection';
import { createSegmentBuilder, type SegmentBuilder } from './segment-builder';
import {
  countUnsupported,
  type UnsupportedWordMap,
  unsupportedList,
} from './render-model-unsupported';
import {
  LINE_CATEGORY,
  SEG_KIND,
  SEG_MOTION,
  type BuildRenderModelOptions,
  type BuildRenderModelResult,
  type ProgramEvent,
  type SkippedMotion,
} from './render-model-types';

const AXIS_EPSILON = 1e-9;

type BuildContext = {
  readonly stockGrbl: boolean;
  readonly coordinateRepresentation: BuildRenderModelOptions['coordinateRepresentation'];
  readonly controllerArcToleranceMm: number | undefined;
  readonly laser: LaserRenderState;
  readonly modal: RenderModal;
  readonly segments: SegmentBuilder;
  // The program's own extent, without the assumed start (ADR-255 amendment 2).
  readonly program: ProgramBoundsTracker;
  /** Only with `boundsFromStart` (ADR-630 Amendment 1). */
  readonly placement: ReturnType<typeof createPlacementReader> | null;
  readonly events: ProgramEvent[];
  readonly skipped: SkippedMotion[];
  readonly unsupported: UnsupportedWordMap;
  recognizedWords: number;
  controllerArcBudgetRelief: number; // mc_arc chords maxSegments does not count (ADR-432)
};

export type GcodeRenderModelBuilder = {
  readonly pushLine: (line: string, unplaced?: 'position' | 'origin') => void;
  readonly finish: () => BuildRenderModelResult;
};

export function createGcodeRenderModelBuilder(
  options: BuildRenderModelOptions = {},
  segments: SegmentBuilder = createSegmentBuilder(options.retainPreciseSegmentLengths),
): GcodeRenderModelBuilder {
  // No line or display ceiling (rule 7 / ADR-268). `maxSegments` stays because
  // it is opt-in: only the live countdown passes it as a responsiveness budget
  // it degrades from, never as a refusal of the job itself.
  const context: BuildContext = {
    stockGrbl: options.stockGrbl === true,
    coordinateRepresentation: options.coordinateRepresentation,
    controllerArcToleranceMm: options.controllerArcToleranceMm,
    laser: createLaserRenderState(options),
    modal: freshRenderModal(options.initialPositionMm),
    segments,
    program: createProgramBoundsTracker(options.initialPositionMm),
    placement: options.boundsFromStart === true ? createPlacementReader() : null,
    events: [],
    skipped: [],
    unsupported: new Map(),
    recognizedWords: 0,
    controllerArcBudgetRelief: 0,
  };
  const categories = createLineCategoryBuilder();
  let lineCount = 0;
  let junkLines = 0;
  let terminalResult: BuildRenderModelResult | null = null;

  const pushLine = (raw: string, unplaced?: 'position' | 'origin'): void => {
    if (terminalResult !== null) return;
    recordUnplacedLine(context, lineCount, unplaced);
    const category = processLine(context, raw, lineCount);
    categories.push(category);
    if (category === LINE_CATEGORY.junk) junkLines += 1;
    lineCount += 1;
    const segmentCount = context.segments.count() - context.controllerArcBudgetRelief;
    if (options.maxSegments !== undefined && segmentCount > options.maxSegments) {
      terminalResult = {
        kind: 'error',
        reason: `Program exceeds ${options.maxSegments} render segments.`,
        segmentLimit: {
          maximum: options.maxSegments,
          observed: segmentCount,
        },
      };
    }
  };

  const finish = (): BuildRenderModelResult => {
    if (terminalResult !== null) return terminalResult;
    if (context.recognizedWords === 0) {
      // A junk line means the input was never a program. Without one, every
      // line parsed cleanly as a comment/blank/marker and the program is
      // simply empty — a distinction the operator has to be told, because the
      // two have opposite fixes.
      return {
        kind: 'error',
        reason: junkLines === 0 ? PROGRAM_PARSE_REASON.noMotion : PROGRAM_PARSE_REASON.notGcode,
      };
    }
    const finished = context.segments.finish();
    const stats = computeProgramStats(finished);
    const renderPressure =
      options.renderPressureThreshold !== undefined &&
      finished.segmentCount > options.renderPressureThreshold
        ? { threshold: options.renderPressureThreshold, observed: finished.segmentCount }
        : null;
    return {
      kind: 'ok',
      model: {
        ...finished,
        renderPressure,
        lineCount,
        lineCategories: categories.finish(),
        events: context.events,
        unsupportedWords: unsupportedList(context.unsupported),
        skippedMotions: context.skipped,
        stats: { ...stats, programBounds: context.program.result(stats.motionBounds) },
      },
    };
  };

  return { pushLine, finish };
}

function processLine(context: BuildContext, raw: string, line: number): number {
  if (raw.trim() === '') return LINE_CATEGORY.blank;
  const stripped = stripControllerComments(raw);
  if (stripped === '') return LINE_CATEGORY.comment;
  if (stripped === '%') return LINE_CATEGORY.marker;
  if (isNativeLaserConsoleLine(context.laser, stripped)) {
    context.recognizedWords += 1;
    return LINE_CATEGORY.modalOnly;
  }
  const words = scanControllerRenderWords(
    stripped,
    context.coordinateRepresentation === 'grbl' ? grblCoordinateWord : undefined,
  );
  if (words === null || words.length === 0) return LINE_CATEGORY.junk;
  context.recognizedWords += words.length;
  if (recordGrblBlock(context, stripped, words, line)) return LINE_CATEGORY.unsupported;
  updateLaserRenderState(context.laser, words, raw);
  const accounting = {
    countUnsupported: (word: string, atLine: number) =>
      countUnsupported(context.unsupported, word, atLine),
    pushEvent: (event: ProgramEvent) => context.events.push(event),
  };
  const motionWords = nativeLaserMotionWords(context.laser, words, {
    modal: context.modal,
    line,
    accounting,
  });
  const outcome = applyLineWords(context.modal, motionWords, line, accounting);
  if (emitPlacedLineMotion(context, outcome, motionWords, line)) return LINE_CATEGORY.motion;
  return nonMotionCategory(outcome, motionWords !== words);
}

function recordGrblBlock(
  context: BuildContext,
  raw: string,
  words: ReadonlyArray<GcodeWordMatch>,
  line: number,
): boolean {
  if (!context.stockGrbl) return false;
  const rejected =
    grblBlockRejection(raw) ??
    grblArcBlockRejection(context.modal, words, context.program.canPlace);
  if (rejected !== null) {
    context.skipped.push({ line, reason: grblRejectedBlockWarning(rejected) });
    return true;
  }
  if (grblBlockUncertainty(raw) !== null) recordUnplacedLine(context, line, 'origin');
  return false;
}

// Without `boundsFromStart` every line's axis words are ordinary motion.
function emitPlacedLineMotion(
  context: BuildContext,
  outcome: ReturnType<typeof applyLineWords>,
  words: ReadonlyArray<GcodeWordMatch>,
  line: number,
): boolean {
  if (context.placement === null) return emitLineMotion(context, outcome, line);
  const placement = context.placement(words, context.modal.unitScale);
  placeBeforeMotion(context.program, context.modal, placement);
  const moved =
    placement.motion !== 'none' &&
    emitLineMotion(context, outcome, line, placement.motion !== 'unplaced');
  if (placement.unknownAfter.length > 0) context.program.forget(placement.unknownAfter);
  return moved;
}

// Routes a line to the right emitter. Returns whether it produced motion.
function emitLineMotion(
  context: BuildContext,
  outcome: ReturnType<typeof applyLineWords>,
  line: number,
  placed = true,
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
  emitMotion(context, outcome.axisWords, line, placed);
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
  context.program.forget(axes);
}

function emitMotion(
  context: BuildContext,
  axisWords: ReadonlyMap<string, number>,
  line: number,
  placed: boolean,
): void {
  const { modal } = context;
  const target = resolveTarget(modal, axisWords);
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
    context.skipped.push({ line, reason: 'non-finite target coordinate' });
    return;
  }
  if (modal.motion === 2 || modal.motion === 3) {
    // A skipped (invalid) arc moves nothing — the controller would have
    // rejected the line, so the modal position must not advance either. An
    // external run's review names it as not in the Frame outline (ADR-630
    // Amendment 2), since a controller with looser limits may still run it.
    if (!emitArc(context, axisWords, target, line)) return;
  } else {
    emitLinear(context, target, line);
  }
  // A move the outline cannot place leaves its axes unknown instead (the
  // caller forgets them), so its end is not counted.
  if (placed) context.program.moveTo(target, axisWords, modal.absolute);
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
  const parameters = resolveCycleParameters(modal, axisWords, peckDepth);
  const target = resolveTarget(modal, axisWords);
  if (parameters === null) {
    context.skipped.push({ line, reason: 'canned cycle needs both R and Z' });
    return;
  }
  const from = { x: modal.x, y: modal.y, z: modal.z };
  const moves = expandCannedCycle({
    cycle,
    retract: modal.retractMode,
    target: { x: target.x, y: target.y, z: parameters.depth },
    rPlane: parameters.rPlane,
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
  context.program.cycle(moves, from, axisWords, modal.absolute);
  if (parameters.dwellSeconds !== null) {
    context.events.push({ kind: 'dwell', line, seconds: Math.max(0, parameters.dwellSeconds) });
  }
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
  const xyKind =
    modal.motion === 0 || isLaserOffFeed(context.laser, modal) ? SEG_KIND.travel : SEG_KIND.cut;
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
    power: renderedPower(context.laser, modal),
    lengthMm: length,
  });
}
