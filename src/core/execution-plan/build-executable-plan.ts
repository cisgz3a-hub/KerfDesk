import {
  buildGcodeRenderModel,
  SEG_KIND,
  SEG_MOTION,
  type GcodeRenderModel,
  type ProgramEvent,
} from '../gcode-view';
// Deep import: core/job's legacy barrel is CI-ratcheted at 85 exports and may only shrink.
import { buildMotionManifest, type MotionBlock } from '../job/motion-manifest';
import { assembleExecutablePlan } from './assemble-executable-plan';
import {
  type BuildExecutablePlanOptions,
  type BuildExecutablePlanResult,
  type ExecutablePlanBuildIssue,
  type ExecutablePlanMotion,
  type ExecutablePlanMotionIntent,
  type ExecutablePlanMotionMode,
  type ExecutablePlanPoint,
} from './executable-plan-types';

const FLOAT32_ENDPOINT_TOLERANCE_MM = 1e-6;

type RenderLineMotion = {
  readonly line: number;
  readonly firstSegment: number;
  readonly lastSegment: number;
  readonly mode: number;
  readonly feed: number;
  readonly power: number;
  readonly segmentCount: number;
};

type AlignmentContext = {
  readonly renderLines: ReadonlyMap<number, RenderLineMotion>;
  readonly model: GcodeRenderModel;
  readonly options: BuildExecutablePlanOptions;
  readonly armedByLine: ReadonlyMap<number, boolean>;
  readonly issues: ExecutablePlanBuildIssue[];
};

type MotionIntentInput = {
  readonly block: MotionBlock;
  readonly rendered: RenderLineMotion;
  readonly firstRenderKind: number | undefined;
  readonly machineKind: BuildExecutablePlanOptions['machineKind'];
  readonly spindleState: 'armed' | 'off';
};

/** Builds a deterministic v1 semantic sidecar from one exact G-code program. */
export function buildExecutablePlan(
  gcode: string,
  options: BuildExecutablePlanOptions,
): BuildExecutablePlanResult {
  if (gcode.length === 0) return { kind: 'unavailable', reason: 'no-program' };
  const rendered = buildGcodeRenderModel(gcode);
  if (rendered.kind === 'error') {
    return {
      kind: 'error',
      reason: 'parse-error',
      issues: [{ code: 'render-parse-error', message: rendered.reason }],
    };
  }
  if (rendered.model.skippedMotions.length > 0) {
    return {
      kind: 'error',
      reason: 'parse-error',
      issues: rendered.model.skippedMotions.map((skipped) => ({
        code: 'skipped-motion',
        message: skipped.reason,
        rawLineIndex: skipped.line,
      })),
    };
  }
  return buildAlignedPlan(gcode, rendered.model, options);
}

function buildAlignedPlan(
  gcode: string,
  model: GcodeRenderModel,
  options: BuildExecutablePlanOptions,
): BuildExecutablePlanResult {
  const manifest = buildMotionManifest(gcode, { machineKind: options.machineKind });
  const collected = collectRenderLines(model);
  if (collected.issues.length > 0) return semanticError(collected.issues);
  const issues: ExecutablePlanBuildIssue[] = [];
  const armedByLine = spindleArmedAtMotionLines(model.events, manifest.blocks);
  const context: AlignmentContext = {
    renderLines: collected.lines,
    model,
    options,
    armedByLine,
    issues,
  };
  const motions = manifest.blocks.map((block, index) => alignMotion(block, index, context));
  const manifestLines = new Set(manifest.blocks.map((block) => block.rawLineIndex));
  for (const line of collected.lines.keys()) {
    if (!manifestLines.has(line)) {
      issues.push({
        code: 'motion-line-mismatch',
        message: `Render motion on raw line ${line} has no controller-manifest block.`,
        rawLineIndex: line,
      });
    }
  }
  if (issues.length > 0 || motions.some((motion) => motion === null)) {
    return semanticError(issues);
  }
  const alignedMotions = motions.filter(
    (motion): motion is ExecutablePlanMotion => motion !== null,
  );
  return {
    kind: 'ok',
    plan: assembleExecutablePlan({
      gcode,
      model,
      options,
      motions: alignedMotions,
      sendableLineCount: manifest.sendableLineCount,
    }),
  };
}

function collectRenderLines(model: GcodeRenderModel): {
  readonly lines: ReadonlyMap<number, RenderLineMotion>;
  readonly issues: ReadonlyArray<ExecutablePlanBuildIssue>;
} {
  const lines = new Map<number, RenderLineMotion>();
  const issues: ExecutablePlanBuildIssue[] = [];
  for (let index = 0; index < model.segmentCount; index += 1) {
    const line = model.segLine[index];
    const mode = model.segMotion[index];
    if (line === undefined || mode === undefined) continue;
    const existing = lines.get(line);
    if (existing !== undefined && existing.mode !== mode) {
      issues.push({
        code: 'compound-motion-line',
        message: `Raw line ${line} expands to more than one motion mode.`,
        rawLineIndex: line,
      });
      continue;
    }
    lines.set(line, {
      line,
      firstSegment: existing?.firstSegment ?? index,
      lastSegment: index,
      mode,
      feed: model.segFeed[index] ?? 0,
      power: model.segPower[index] ?? 0,
      segmentCount: (existing?.segmentCount ?? 0) + 1,
    });
  }
  return { lines, issues };
}

function alignMotion(
  block: MotionBlock,
  index: number,
  context: AlignmentContext,
): ExecutablePlanMotion | null {
  const rendered = context.renderLines.get(block.rawLineIndex);
  if (rendered === undefined) {
    context.issues.push({
      code: 'motion-line-mismatch',
      message: `Controller motion on raw line ${block.rawLineIndex} has no render motion.`,
      rawLineIndex: block.rawLineIndex,
    });
    return null;
  }
  const manifestStart = block.points[0];
  const manifestEnd = block.points.at(-1);
  const renderStart = renderSegmentStart(context.model, rendered.firstSegment);
  const renderEnd = renderSegmentEnd(context.model, rendered.lastSegment);
  if (
    manifestStart === undefined ||
    manifestEnd === undefined ||
    !sameEndpoint(manifestStart, renderStart) ||
    !sameEndpoint(manifestEnd, renderEnd)
  ) {
    context.issues.push({
      code: 'endpoint-mismatch',
      message: `Independent parsers disagree on endpoints for raw line ${block.rawLineIndex}.`,
      rawLineIndex: block.rawLineIndex,
    });
    return null;
  }
  return {
    id: `motion-${String(index + 1).padStart(6, '0')}`,
    rawLineIndex: block.rawLineIndex,
    sendableLineIndex: block.sendableLineIndex,
    programLineNumber: block.programLineNumber,
    mode: motionMode(rendered.mode),
    intent: motionIntent({
      block,
      rendered,
      firstRenderKind: context.model.segKind[rendered.firstSegment],
      machineKind: context.options.machineKind,
      spindleState: context.armedByLine.get(block.rawLineIndex) === true ? 'armed' : 'off',
    }),
    pointsMm: block.points.map(copyPoint),
    lengthMm: block.lengthMm,
    routeStartMm: block.routeStartMm,
    routeEndMm: block.routeEndMm,
    feedMmPerMin: rendered.feed > 0 ? rendered.feed : null,
    power: rendered.power,
    sourceSegmentCount: rendered.segmentCount,
  };
}

function renderSegmentStart(model: GcodeRenderModel, segment: number): ExecutablePlanPoint {
  return renderPointAtOffset(model, segment * 6);
}

function renderSegmentEnd(model: GcodeRenderModel, segment: number): ExecutablePlanPoint {
  return renderPointAtOffset(model, segment * 6 + 3);
}

function renderPointAtOffset(model: GcodeRenderModel, offset: number): ExecutablePlanPoint {
  return {
    x: model.positions[offset] ?? 0,
    y: model.positions[offset + 1] ?? 0,
    z: model.positions[offset + 2] ?? 0,
  };
}

function sameEndpoint(expected: ExecutablePlanPoint, actual: ExecutablePlanPoint): boolean {
  return (
    sameFloat32(expected.x, actual.x) &&
    sameFloat32(expected.y, actual.y) &&
    sameFloat32(expected.z, actual.z)
  );
}

function sameFloat32(expected: number, actual: number): boolean {
  return Math.abs(Math.fround(expected) - actual) <= FLOAT32_ENDPOINT_TOLERANCE_MM;
}

function motionMode(mode: number): ExecutablePlanMotionMode {
  if (mode === SEG_MOTION.rapid) return 'rapid';
  if (mode === SEG_MOTION.linear) return 'linear';
  if (mode === SEG_MOTION.cw) return 'clockwise-arc';
  return 'counterclockwise-arc';
}

function motionIntent(input: MotionIntentInput): ExecutablePlanMotionIntent {
  if (input.block.kind !== 'plunge') return input.block.kind;
  if (input.rendered.mode === SEG_MOTION.cw || input.rendered.mode === SEG_MOTION.ccw) {
    const energized =
      input.machineKind === 'cnc'
        ? input.spindleState === 'armed'
        : input.spindleState === 'armed' && input.rendered.power > 0;
    return energized ? 'process' : 'travel';
  }
  return input.firstRenderKind === SEG_KIND.retract ? 'retract' : 'plunge';
}

function spindleArmedAtMotionLines(
  events: ReadonlyArray<ProgramEvent>,
  blocks: ReadonlyArray<MotionBlock>,
): ReadonlyMap<number, boolean> {
  const result = new Map<number, boolean>();
  let armed = false;
  let eventIndex = 0;
  for (const block of blocks) {
    while ((events[eventIndex]?.line ?? Number.POSITIVE_INFINITY) <= block.rawLineIndex) {
      const event = events[eventIndex];
      if (event?.kind === 'spindle-on') armed = true;
      else if (event?.kind === 'spindle-off') armed = false;
      eventIndex += 1;
    }
    result.set(block.rawLineIndex, armed);
  }
  return result;
}

function copyPoint(point: ExecutablePlanPoint): ExecutablePlanPoint {
  return { x: point.x, y: point.y, z: point.z };
}

function semanticError(issues: ReadonlyArray<ExecutablePlanBuildIssue>): BuildExecutablePlanResult {
  return { kind: 'error', reason: 'semantic-mismatch', issues };
}
